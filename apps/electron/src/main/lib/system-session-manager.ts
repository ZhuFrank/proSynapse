/**
 * 系统会话管理器
 *
 * 负责管理应用内部使用的"系统会话"（非用户手动创建），
 * 并将其 ID 持久化到 settings.json，确保跨启动复用同一会话。
 *
 * 当前管理的系统会话：
 * - 定时任务会话（scheduledTaskSystemSessionId）：用于接收定时任务的执行记录
 */

import { createAgentSession, listAgentSessions } from './agent-session-manager'
import { getSettings, updateSettings } from './settings-service'

/**
 * 确保"定时任务"系统会话存在，返回其 ID。
 *
 * - 若 settings 中已记录 ID 且对应会话仍存在，直接返回该 ID
 * - 否则创建新的系统会话，并将 ID 写入 settings，之后返回
 *
 * @param channelId   使用的渠道 ID（创建新会话时需要）
 * @param workspaceId 所属工作区 ID（可选）
 * @returns 定时任务系统会话 ID
 */
export function ensureScheduledTaskSession(channelId: string, workspaceId?: string): string {
  const settings = getSettings()
  const existingId = settings.scheduledTaskSystemSessionId

  if (existingId) {
    const all = listAgentSessions()
    if (all.find((s) => s.id === existingId)) {
      return existingId
    }
  }

  const meta = createAgentSession('定时任务', channelId, workspaceId, {
    isSystemSession: true,
    systemSessionType: 'scheduled-tasks',
  })

  updateSettings({ scheduledTaskSystemSessionId: meta.id })
  console.log('[定时任务] 已创建/绑定系统会话:', meta.id)

  return meta.id
}
