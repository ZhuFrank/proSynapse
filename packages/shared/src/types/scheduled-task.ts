export type Trigger =
  | { type: 'cron';     expression: string;  timezone?: string }
  | { type: 'once';     runAt: number }
  | { type: 'interval'; everyMs: number;      startAt?: number }

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  trigger: Trigger
  channelId: string
  modelId: string
  workspaceId?: string
  enabled: boolean
  lastRunAt?: number
  nextRunAt?: number
  lastRunStatus?: 'success' | 'error'
  lastRunError?: string
  createdAt: number
  updatedAt: number
}
