/**
 * 调度器单例
 *
 * 维护进程内所有定时任务的 setTimeout 句柄，
 * 用 cron-parser v5 计算 cron 触发时间，
 * 提供 startScheduler / stopScheduler / rescheduleTask / runTaskNow 四个公开 API。
 */

import { CronExpressionParser } from 'cron-parser' // v5 named export
import { listTasks, getTask, updateTask } from './scheduled-task-store'
import { runScheduledTaskOnce } from './scheduled-task-runner'
import type { ScheduledTask, Trigger } from '@proma/shared'

/** taskId → setTimeout 句柄 */
const timers = new Map<string, NodeJS.Timeout>()
let started = false

/**
 * 计算下次触发时间（毫秒时间戳）。
 * 返回 null 表示该任务不需要再次触发（例如 once 已过期、cron 解析失败）。
 */
function computeNextRunAt(trigger: Trigger, fromMs: number): number | null {
  switch (trigger.type) {
    case 'cron':
      try {
        const it = CronExpressionParser.parse(trigger.expression, {
          currentDate: new Date(fromMs),
          tz: trigger.timezone,
        })
        return it.next().getTime()
      } catch (e) {
        console.error('[调度器] cron 解析失败', trigger.expression, e)
        return null
      }
    case 'once':
      return trigger.runAt > fromMs ? trigger.runAt : null
    case 'interval': {
      if (!Number.isFinite(trigger.everyMs) || trigger.everyMs <= 0) {
        console.error('[调度器] interval everyMs 非法:', trigger.everyMs)
        return null
      }
      const start = trigger.startAt ?? fromMs
      if (start > fromMs) return start
      const elapsed = fromMs - start
      const cycles = Math.ceil(elapsed / trigger.everyMs) || 1
      return start + cycles * trigger.everyMs
    }
  }
}

/**
 * 为单个任务排队 setTimeout。
 * 若任务已禁用或无下次触发时间，静默跳过。
 */
function scheduleOne(task: ScheduledTask): void {
  cancelOne(task.id)
  if (!task.enabled) return

  const next = computeNextRunAt(task.trigger, Date.now())
  if (next == null || !Number.isFinite(next)) return

  updateTask(task.id, { nextRunAt: next })

  // setTimeout 最大约 24.8 天（2^31-1 ms）；若超过 MAX 先排占位 timer，到时重新规划
  const MAX = 2_000_000_000
  const delay = next - Date.now()

  const t = setTimeout(async () => {
    timers.delete(task.id)

    // 延迟超限：重新计算，不触发任务；重新读取最新状态，避免使用过期闭包
    if (delay >= MAX) {
      const latest = getTask(task.id)
      if (latest) scheduleOne(latest)
      return
    }

    // 触发前再次读取最新状态，确保任务仍然启用
    const fresh = getTask(task.id)
    if (!fresh || !fresh.enabled) return

    try {
      await runScheduledTaskOnce(fresh)
    } catch (e) {
      // runner 已内部吞错；这里兜底保险
      console.error('[调度器] runner 抛出异常（不应发生）', task.id, e)
    }

    // once 类型：执行完后禁用任务
    if (fresh.trigger.type === 'once') {
      updateTask(task.id, { enabled: false, nextRunAt: undefined })
    } else {
      // cron / interval：用最新状态（含 lastRunAt）重新排队
      const post = getTask(task.id)
      if (post) scheduleOne(post)
    }
  }, Math.min(delay, MAX))

  timers.set(task.id, t)
  console.log(`[调度器] 排队 ${task.name} → ${new Date(next).toISOString()}`)
}

/** 取消单个任务的 timer */
function cancelOne(id: string): void {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

/** 启动调度器，为所有已启用任务排队 */
export function startScheduler(): void {
  if (started) return
  started = true
  console.log('[调度器] 启动')
  for (const task of listTasks()) scheduleOne(task)
}

/** 停止调度器，清除所有 timer */
export function stopScheduler(): void {
  for (const id of Array.from(timers.keys())) cancelOne(id)
  started = false
  console.log('[调度器] 已停止')
}

/** 重新排队指定任务（创建 / 更新任务后调用） */
export function rescheduleTask(id: string): void {
  const task = getTask(id)
  if (task) scheduleOne(task)
}

/** 立即执行指定任务（不影响已有的调度计划） */
export async function runTaskNow(id: string): Promise<void> {
  const task = getTask(id)
  if (task) await runScheduledTaskOnce(task)
}
