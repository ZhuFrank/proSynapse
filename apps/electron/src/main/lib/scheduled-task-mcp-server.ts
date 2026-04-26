/**
 * 定时任务 MCP Server（供 Agent 使用）
 *
 * 通过 SDK 的 createSdkMcpServer + tool helper 注册 7 个本地定时任务工具，
 * 让 Agent 在普通会话中能听懂"帮我每天 X 点 Y"并在本地创建任务，
 * 而不是建议云端方案。
 *
 * 工厂函数接受默认的 channelId / modelId / workspaceId，
 * 在 schedule_task 中若 Agent 未显式传值则自动填充当前会话上下文。
 */

import { z } from 'zod'
import { createTask, listTasks, deleteTask, updateTask, getTask } from './scheduled-task-store'
import { rescheduleTask, unschedule, runTaskNow } from './scheduler'
import { validateTrigger, validateCreateInput } from './scheduled-task-validation'

/** 工厂入参：当前 Agent 会话的默认上下文 */
export interface ScheduledTaskMcpServerDefaults {
  defaultChannelId: string
  defaultModelId: string
  defaultWorkspaceId?: string
}

/**
 * 创建定时任务 MCP Server 实例
 *
 * 每次 sendMessage 调用时以当前会话的 channelId/modelId/workspaceId 为默认值构造，
 * 避免全局 singleton 跨会话混淆。
 */
export function createScheduledTaskMcpServer(
  defaults: ScheduledTaskMcpServerDefaults,
) {
  // 延迟导入 SDK，与 orchestrator 保持一致
  const sdk = require('@anthropic-ai/claude-agent-sdk') as typeof import('@anthropic-ai/claude-agent-sdk')

  const { defaultChannelId, defaultModelId, defaultWorkspaceId } = defaults

  // ── trigger zod schema（三种类型）──
  const triggerSchema = z.union([
    z.object({
      type: z.literal('cron').describe('Cron 表达式触发，支持标准 5 字段 cron'),
      expression: z.string().describe('Cron 表达式，如 "0 9 * * 1-5"（每个工作日 09:00）'),
      timezone: z.string().optional().describe('时区，如 "Asia/Shanghai"，默认系统时区'),
    }),
    z.object({
      type: z.literal('once').describe('指定时间点触发一次'),
      runAt: z.number().describe('触发时间戳（毫秒）'),
    }),
    z.object({
      type: z.literal('interval').describe('固定间隔触发'),
      everyMs: z.number().describe('间隔毫秒数，如 3600000 为每小时'),
      startAt: z.number().optional().describe('首次触发时间戳（毫秒），默认立即开始'),
    }),
  ])

  return sdk.createSdkMcpServer({
    name: 'proma-scheduled-tasks',
    version: '1.0.0',
    tools: [
      // ── 1. schedule_task ──
      sdk.tool(
        'schedule_task',
        '在用户本机的 Proma Electron 进程内创建一个本地定时任务（**不是云端**）。\n' +
          '任务到时由 Proma 调起 agent 在本地运行。支持 cron / 一次性 Date / 间隔 三种触发方式。\n' +
          'channelId / modelId 默认沿用当前会话的值，无需追问用户。',
        {
          name: z.string().describe('任务名称，用于展示和识别'),
          prompt: z.string().describe('任务触发时发送给 Agent 的提示词'),
          trigger: triggerSchema.describe('触发规则：cron / once / interval 三种类型'),
          channelId: z.string().optional().describe('渠道 ID（默认使用当前会话渠道）'),
          modelId: z.string().optional().describe('模型 ID（默认使用当前会话模型）'),
          workspaceId: z.string().optional().describe('工作区 ID（默认使用当前会话工作区）'),
        },
        async (args) => {
          try {
            const input = {
              name: args.name,
              prompt: args.prompt,
              trigger: args.trigger,
              channelId: args.channelId || defaultChannelId,
              modelId: args.modelId || defaultModelId,
              workspaceId: args.workspaceId || defaultWorkspaceId,
            }
            validateCreateInput(input)
            const task = createTask(input)
            rescheduleTask(task.id)
            console.log('[定时任务 MCP] schedule_task 创建成功:', task.id)
            return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `错误: ${msg}` }], isError: true }
          }
        },
      ),

      // ── 2. list_scheduled_tasks ──
      sdk.tool(
        'list_scheduled_tasks',
        '列出用户本机 Proma Electron 进程内的所有本地定时任务（**不是云端**）。',
        {},
        async () => {
          try {
            const tasks = listTasks()
            return { content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `错误: ${msg}` }], isError: true }
          }
        },
      ),

      // ── 3. cancel_scheduled_task ──
      sdk.tool(
        'cancel_scheduled_task',
        '取消并删除用户本机 Proma Electron 进程内的一个本地定时任务（**不是云端**）。\n' +
          '会先从调度器中移除，再从存储中删除。',
        {
          id: z.string().describe('要取消的任务 ID'),
        },
        async (args) => {
          try {
            unschedule(args.id)
            const deleted = deleteTask(args.id)
            console.log('[定时任务 MCP] cancel_scheduled_task:', args.id, deleted)
            return { content: [{ type: 'text' as const, text: JSON.stringify(deleted) }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `错误: ${msg}` }], isError: true }
          }
        },
      ),

      // ── 4. pause_scheduled_task ──
      sdk.tool(
        'pause_scheduled_task',
        '暂停用户本机 Proma Electron 进程内的一个本地定时任务（**不是云端**）。\n' +
          '任务保留配置但停止触发，直到恢复为止。',
        {
          id: z.string().describe('要暂停的任务 ID'),
        },
        async (args) => {
          try {
            const task = updateTask(args.id, { enabled: false })
            if (!task) {
              return { content: [{ type: 'text' as const, text: `错误: 任务不存在 (id=${args.id})` }], isError: true }
            }
            rescheduleTask(args.id)
            console.log('[定时任务 MCP] pause_scheduled_task:', args.id)
            return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `错误: ${msg}` }], isError: true }
          }
        },
      ),

      // ── 5. resume_scheduled_task ──
      sdk.tool(
        'resume_scheduled_task',
        '恢复用户本机 Proma Electron 进程内的一个已暂停的本地定时任务（**不是云端**）。\n' +
          '重新激活后将按原有触发规则继续调度。',
        {
          id: z.string().describe('要恢复的任务 ID'),
        },
        async (args) => {
          try {
            const task = updateTask(args.id, { enabled: true })
            if (!task) {
              return { content: [{ type: 'text' as const, text: `错误: 任务不存在 (id=${args.id})` }], isError: true }
            }
            rescheduleTask(args.id)
            console.log('[定时任务 MCP] resume_scheduled_task:', args.id)
            return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `错误: ${msg}` }], isError: true }
          }
        },
      ),

      // ── 6. update_scheduled_task ──
      sdk.tool(
        'update_scheduled_task',
        '更新用户本机 Proma Electron 进程内的一个本地定时任务的配置（**不是云端**）。\n' +
          '更新后自动重新排队调度。',
        {
          id: z.string().describe('要更新的任务 ID'),
          patch: z
            .object({
              name: z.string().optional().describe('新任务名称'),
              prompt: z.string().optional().describe('新提示词'),
              trigger: triggerSchema.optional().describe('新触发规则'),
              channelId: z.string().optional().describe('新渠道 ID'),
              modelId: z.string().optional().describe('新模型 ID'),
              workspaceId: z.string().optional().describe('新工作区 ID'),
              enabled: z.boolean().optional().describe('是否启用'),
            })
            .describe('要更新的字段（只需传需要改动的字段）'),
        },
        async (args) => {
          try {
            // 如果 patch 中有 trigger，先单独校验
            if (args.patch.trigger) {
              validateTrigger(args.patch.trigger)
            }
            const task = updateTask(args.id, args.patch)
            if (!task) {
              return { content: [{ type: 'text' as const, text: `错误: 任务不存在 (id=${args.id})` }], isError: true }
            }
            rescheduleTask(args.id)
            console.log('[定时任务 MCP] update_scheduled_task:', args.id)
            return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `错误: ${msg}` }], isError: true }
          }
        },
      ),

      // ── 7. run_scheduled_task_now ──
      sdk.tool(
        'run_scheduled_task_now',
        '立即触发执行用户本机 Proma Electron 进程内的一个本地定时任务（**不是云端**）。\n' +
          '不等待执行完成即返回，不影响原有的调度计划。',
        {
          id: z.string().describe('要立即执行的任务 ID'),
        },
        async (args) => {
          try {
            // 先验证任务存在
            const task = getTask(args.id)
            if (!task) {
              return { content: [{ type: 'text' as const, text: `错误: 任务不存在 (id=${args.id})` }], isError: true }
            }
            // fire-and-forget，不 await
            runTaskNow(args.id).catch((err: unknown) => {
              console.error('[定时任务 MCP] run_scheduled_task_now 执行失败:', args.id, err)
            })
            console.log('[定时任务 MCP] run_scheduled_task_now fire-and-forget:', args.id)
            return { content: [{ type: 'text' as const, text: '已开始执行，任务在后台运行中' }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `错误: ${msg}` }], isError: true }
          }
        },
      ),
    ],
  })
}
