/**
 * 定时任务执行器（一次触发）
 *
 * 职责：
 * 1. 给固定的"定时任务"系统会话写一条 user 消息（含任务名 + prompt + sub-session 引用）
 * 2. 创建一个临时 sub-session，用 runAgentHeadless() 跑 agent 完整对话
 * 3. 等 agent 跑完后，把 assistant 最后一句回复（或错误）追加到固定系统会话
 * 4. 更新 task 的 lastRunAt / lastRunStatus / lastRunError
 */

import { randomUUID } from 'node:crypto'
import { runAgentHeadless } from './agent-service'
import { createAgentSession, appendAgentMessage, getAgentSessionSDKMessages } from './agent-session-manager'
import { ensureScheduledTaskSession } from './system-session-manager'
import { updateTask } from './scheduled-task-store'
import type { ScheduledTask, SDKAssistantMessage } from '@proma/shared'

/** 从 SDKAssistantMessage 的 content 数组中提取纯文本（跳过 tool_use / thinking 块） */
function extractAssistantText(msg: SDKAssistantMessage): string {
  return msg.message.content
    .filter((b) => b.type === 'text' && 'text' in b)
    .map((b) => (b as { text: string }).text)
    .join('')
}

/**
 * 执行一次定时任务
 *
 * 外层 try/catch 只捕获 runAgentHeadless 抛出的致命错误。
 * 后续的会话写入和任务状态更新均用独立 try/catch 做最佳努力处理，绝不向上抛。
 * Scheduler 调用方靠 lastRunStatus 判断成败。
 */
export async function runScheduledTaskOnce(task: ScheduledTask): Promise<void> {
  const subSession = createAgentSession(
    `[定时] ${task.name} @ ${new Date().toISOString()}`,
    task.channelId,
    task.workspaceId,
  )
  const systemSessionId = ensureScheduledTaskSession(task.channelId, task.workspaceId)
  const startedAt = Date.now()

  appendAgentMessage(systemSessionId, {
    id: randomUUID(),
    role: 'user',
    content: `🕒 **${task.name}** 触发\n\n${task.prompt}\n\n_(详情：sub-session ${subSession.id})_`,
    createdAt: startedAt,
  })

  let runResult: 'success' | 'error' = 'success'
  let runError = ''

  try {
    await runAgentHeadless(
      {
        sessionId: subSession.id,
        userMessage: task.prompt,
        channelId: task.channelId,
        modelId: task.modelId,
        workspaceId: task.workspaceId,
      },
      {
        // orchestrator 可能先调用 onError 再 throw（致命路径）或直接 return（提前退出路径）。
        // throw 时 catch 块负责上报；return 时 errorMessage 在 await 后汇入下方报告路径。
        // 两条路径最终都只写一条系统会话消息。
        onError: (error: string) => {
          runResult = 'error'
          runError = `❌ 执行失败: ${error}`
        },
        onComplete: () => {
          // onComplete 不携带 messages 参数；最终消息从 sub-session JSONL 读取
        },
        onTitleUpdated: (_title: string) => {},
      },
    )
  } catch (err: unknown) {
    runResult = 'error'
    runError = err instanceof Error ? err.message : String(err)
    console.error('[定时任务] 执行失败', task.id, err)
  }

  // 从 sub-session JSONL 读取最后一条 assistant SDKMessage（Phase 4 格式）
  let replyContent: string
  if (runResult === 'error') {
    replyContent = `❌ 执行失败: ${runError}`
  } else {
    const sdkMessages = getAgentSessionSDKMessages(subSession.id)
    const lastAssistant = sdkMessages.filter((m): m is SDKAssistantMessage => m.type === 'assistant').pop()
    replyContent = (lastAssistant ? extractAssistantText(lastAssistant) : '') || '_(无回复)_'
  }

  // 后续记账操作：最佳努力，任意一步失败都不影响另一步
  try {
    appendAgentMessage(systemSessionId, {
      id: randomUUID(),
      role: 'assistant',
      content: replyContent,
      createdAt: Date.now(),
    })
  } catch (e) {
    console.error('[定时任务] 写系统会话失败', e)
  }

  try {
    updateTask(task.id, {
      lastRunAt: startedAt,
      lastRunStatus: runResult,
      lastRunError: runError || undefined,
    })
  } catch (e) {
    console.error('[定时任务] 更新任务状态失败', e)
  }
}
