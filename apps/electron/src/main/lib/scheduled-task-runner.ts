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
import { createAgentSession, appendAgentMessage, getAgentSessionMessages } from './agent-session-manager'
import { ensureScheduledTaskSession } from './system-session-manager'
import { updateTask } from './scheduled-task-store'
import type { ScheduledTask } from '@proma/shared'

/**
 * 执行一次定时任务
 *
 * 外层 try/catch 只用于把错误写进系统会话和落 lastRunError，然后退出（不向上抛）。
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

  let errorMessage = ''

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
        onError: (error: string) => {
          errorMessage = `❌ 执行失败: ${error}`
        },
        onComplete: () => {
          // onComplete 不携带 messages 参数；最终消息从 sub-session JSONL 读取
        },
        onTitleUpdated: (_title: string) => {},
      },
    )

    // 从 sub-session JSONL 读取最后一条 assistant 消息
    const messages = getAgentSessionMessages(subSession.id)
    const lastAssistant = messages.filter(m => m.role === 'assistant').pop()
    const replyContent = errorMessage || lastAssistant?.content || '_(无回复)_'

    appendAgentMessage(systemSessionId, {
      id: randomUUID(),
      role: 'assistant',
      content: replyContent,
      createdAt: Date.now(),
    })

    const status = errorMessage ? 'error' : 'success'
    updateTask(task.id, {
      lastRunAt: startedAt,
      lastRunStatus: status,
      lastRunError: errorMessage || undefined,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    appendAgentMessage(systemSessionId, {
      id: randomUUID(),
      role: 'assistant',
      content: `❌ 执行失败: ${message}`,
      createdAt: Date.now(),
    })
    updateTask(task.id, {
      lastRunAt: startedAt,
      lastRunStatus: 'error',
      lastRunError: message,
    })
    console.error('[定时任务] 执行失败', task.id, err)
  }
}
