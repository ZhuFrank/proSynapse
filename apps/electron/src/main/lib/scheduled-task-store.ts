/**
 * 定时任务持久化 Store
 *
 * 管理定时任务配置的读写。
 * 存储在 ~/.proma/scheduled-tasks.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getScheduledTasksPath } from './config-paths'
import type { ScheduledTask } from '@proma/shared'

interface FileShape {
  tasks: ScheduledTask[]
}

function read(): FileShape {
  const filePath = getScheduledTasksPath()

  if (!existsSync(filePath)) return { tasks: [] }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as FileShape
  } catch (e) {
    console.error('[定时任务] 配置文件解析失败，使用空列表:', e)
    return { tasks: [] }
  }
}

function write(data: FileShape): void {
  writeFileSync(getScheduledTasksPath(), JSON.stringify(data, null, 2), 'utf-8')
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
  write(data)
  return data.tasks.length < before
}
