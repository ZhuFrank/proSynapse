/**
 * 定时任务输入校验
 *
 * 供 IPC 入口（ipc.ts）和未来 MCP Server 共用，
 * 不应被 scheduled-task-store.ts 引用（避免循环依赖）。
 */

import { CronExpressionParser } from 'cron-parser' // v5 named export
import type { ScheduledTask } from '@proma/shared'

/**
 * 校验 trigger 字段合法性，失败时抛出 Error。
 * cron 类型会实际解析表达式，防止无效 cron 静默失败。
 */
export function validateTrigger(trigger: ScheduledTask['trigger']): void {
  if (trigger.type === 'cron') {
    if (typeof trigger.expression !== 'string' || !trigger.expression.trim()) {
      throw new Error('[定时任务] cron.expression 必须为非空字符串')
    }
    try {
      CronExpressionParser.parse(trigger.expression)
    } catch {
      throw new Error(`[定时任务] cron 表达式无效: "${trigger.expression}"`)
    }
  } else if (trigger.type === 'once') {
    if (typeof trigger.runAt !== 'number' || !Number.isFinite(trigger.runAt)) {
      throw new Error('[定时任务] once.runAt 必须为有限数字时间戳')
    }
  } else if (trigger.type === 'interval') {
    if (typeof trigger.everyMs !== 'number' || !Number.isFinite(trigger.everyMs) || trigger.everyMs <= 0) {
      throw new Error('[定时任务] interval.everyMs 必须为正有限数')
    }
  } else {
    throw new Error(`[定时任务] 未知 trigger.type: ${(trigger as { type: string }).type}`)
  }
}

/** CREATE 输入类型（去掉由 store 自动填充的字段） */
type CreateInput = Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'enabled'> & { enabled?: boolean }

/**
 * 校验 CREATE 请求的完整输入，失败时抛出 Error。
 * 同时通过 asserts 将 input 收窄为 CreateInput。
 */
export function validateCreateInput(input: unknown): asserts input is CreateInput {
  if (typeof input !== 'object' || input === null) {
    throw new Error('[定时任务] 输入必须为对象')
  }
  const obj = input as Record<string, unknown>

  if (!obj.name || typeof obj.name !== 'string') {
    throw new Error('[定时任务] name 必须为非空字符串')
  }
  if (!obj.prompt || typeof obj.prompt !== 'string') {
    throw new Error('[定时任务] prompt 必须为非空字符串')
  }
  if (!obj.channelId || typeof obj.channelId !== 'string') {
    throw new Error('[定时任务] channelId 必须为非空字符串')
  }
  if (!obj.modelId || typeof obj.modelId !== 'string') {
    throw new Error('[定时任务] modelId 必须为非空字符串')
  }
  if (typeof obj.trigger !== 'object' || obj.trigger === null) {
    throw new Error('[定时任务] trigger 必须为对象')
  }
  validateTrigger(obj.trigger as ScheduledTask['trigger'])
}
