/**
 * 定时任务持久化 Store
 *
 * 管理定时任务配置的读写。
 * 存储在 ~/.proma/scheduled-tasks.json
 */

import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'
import { getScheduledTasksPath } from './config-paths'
import type { ScheduledTask } from '@proma/shared'

interface FileShape {
  tasks: ScheduledTask[]
}

function read(): FileShape {
  const filePath = getScheduledTasksPath()

  // 文件不存在 → 首次运行，返回空列表
  if (!existsSync(filePath)) return { tasks: [] }

  // 文件存在但解析失败（含 .bak 回退也失败）→ 抛出以防止覆盖损坏数据
  const data = readJsonFileSafe<FileShape>(filePath)
  if (data === null) {
    console.error('[定时任务] 配置文件损坏且无法恢复，拒绝返回空列表以保护数据:', filePath)
    throw new Error('[定时任务] 配置文件损坏，请检查或删除后重试')
  }
  return data
}

function write(data: FileShape): void {
  writeJsonFileAtomic(getScheduledTasksPath(), data)
}

export function listTasks(): ScheduledTask[] {
  return read().tasks
}

export function getTask(id: string): ScheduledTask | undefined {
  return read().tasks.find(t => t.id === id)
}

export function createTask(
  input: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'enabled'> & { enabled?: boolean },
): ScheduledTask {
  const now = Date.now()
  const task: ScheduledTask = {
    ...input,
    id: randomUUID(),
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  }
  const data = read()
  data.tasks.push(task)
  write(data)
  console.log('[定时任务] 创建:', task.id, task.name)
  return task
}

export function updateTask(id: string, patch: Partial<ScheduledTask>): ScheduledTask | undefined {
  const data = read()
  const idx = data.tasks.findIndex(t => t.id === id)
  if (idx < 0) return undefined
  data.tasks[idx] = { ...data.tasks[idx], ...patch, id, updatedAt: Date.now() } as ScheduledTask
  write(data)
  return data.tasks[idx]
}

export function deleteTask(id: string): boolean {
  const data = read()
  const before = data.tasks.length
  data.tasks = data.tasks.filter(t => t.id !== id)
  if (data.tasks.length === before) return false
  write(data)
  return true
}
