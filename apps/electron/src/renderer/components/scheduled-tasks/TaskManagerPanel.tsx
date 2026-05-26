/**
 * TaskManagerPanel — 定时任务管理面板
 *
 * 渲染在定时任务系统会话视图顶部，提供：
 * - 任务列表（名称、触发摘要、下次运行时间、最近运行状态）
 * - 操作按钮：立即执行 / 暂停 / 启用 / 删除（带确认）/ 编辑
 * - 新建表单（通过 TaskEditDialog）
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Plus, Play, Pause, Trash2, Pencil, CheckCircle2, XCircle, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { TaskEditDialog } from './TaskEditDialog'
import type { ScheduledTask, Trigger } from '@proma/shared'

// ===== 工具函数 =====

/** 格式化 trigger 为人类可读摘要 */
function formatTrigger(trigger: Trigger): string {
  if (trigger.type === 'cron') {
    return `Cron: ${trigger.expression}`
  }
  if (trigger.type === 'once') {
    return `一次性: ${new Date(trigger.runAt).toLocaleString('zh-CN')}`
  }
  // interval
  const ms = trigger.everyMs
  if (ms % 86_400_000 === 0) return `每 ${ms / 86_400_000} 天`
  if (ms % 3_600_000 === 0) return `每 ${ms / 3_600_000} 小时`
  return `每 ${ms / 60_000} 分钟`
}

/** 格式化 nextRunAt 为相对时间字符串 */
function formatNextRun(ts: number | undefined): string {
  if (!ts) return '—'
  const now = Date.now()
  const diffMs = ts - now
  const diffMin = Math.round(diffMs / 60_000)

  if (Math.abs(diffMin) < 1) return '即将运行'
  if (diffMin < 0) return '已过期'
  if (diffMin < 60) return `${diffMin} 分钟后`

  const d = new Date(ts)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const isSameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (isSameDay(d, today)) return `今天 ${timeStr}`
  if (isSameDay(d, tomorrow)) return `明天 ${timeStr}`
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ===== TaskRow =====

interface TaskRowAction {
  onRunNow: (id: string) => Promise<void>
  onPause: (id: string) => Promise<void>
  onResume: (id: string) => Promise<void>
  onEdit: (task: ScheduledTask) => void
  onDeleteRequest: (task: ScheduledTask) => void
}

interface TaskRowProps {
  task: ScheduledTask
  actions: TaskRowAction
}

function TaskRow({ task, actions }: TaskRowProps): React.ReactElement {
  const [runningNow, setRunningNow] = React.useState(false)
  const [toggling, setToggling] = React.useState(false)

  const handleRunNow = async (): Promise<void> => {
    setRunningNow(true)
    try {
      await actions.onRunNow(task.id)
      toast.success(`已执行「${task.name}」`, { description: '已执行：查看消息历史' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`执行失败: ${msg}`)
    } finally {
      setRunningNow(false)
    }
  }

  const handleToggle = async (): Promise<void> => {
    setToggling(true)
    try {
      if (task.enabled) {
        await actions.onPause(task.id)
        toast.success(`已暂停「${task.name}」`)
      } else {
        await actions.onResume(task.id)
        toast.success(`已启用「${task.name}」`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`操作失败: ${msg}`)
    } finally {
      setToggling(false)
    }
  }

  // 状态指示器
  const StatusIcon = (): React.ReactElement => {
    if (!task.lastRunStatus) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Minus className="size-3.5 text-muted-foreground/50" />
          </TooltipTrigger>
          <TooltipContent>从未执行</TooltipContent>
        </Tooltip>
      )
    }
    if (task.lastRunStatus === 'success') {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <CheckCircle2 className="size-3.5 text-green-500" />
          </TooltipTrigger>
          <TooltipContent>上次执行成功</TooltipContent>
        </Tooltip>
      )
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <XCircle className="size-3.5 text-destructive" />
        </TooltipTrigger>
        <TooltipContent>
          上次执行失败{task.lastRunError ? `: ${task.lastRunError}` : ''}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors group">
      {/* 状态指示器 */}
      <div className="shrink-0 mt-px">
        <StatusIcon />
      </div>

      {/* 主要信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-medium truncate ${!task.enabled ? 'text-muted-foreground line-through' : ''}`}>
            {task.name}
          </span>
          {!task.enabled && (
            <span className="text-[10px] text-muted-foreground shrink-0">已暂停</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">{formatTrigger(task.trigger)}</span>
          <span className="text-xs text-muted-foreground/50 shrink-0">·</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {task.enabled ? formatNextRun(task.nextRunAt) : '已暂停'}
          </span>
        </div>
      </div>

      {/* 操作按钮 — hover 时显示 */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* 立即执行 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={runningNow}
              onClick={handleRunNow}
              className="text-muted-foreground hover:text-foreground"
            >
              <Play className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>立即执行</TooltipContent>
        </Tooltip>

        {/* 暂停/启用 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={toggling}
              onClick={handleToggle}
              className="text-muted-foreground hover:text-foreground"
            >
              {task.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5 text-green-500" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{task.enabled ? '暂停' : '启用'}</TooltipContent>
        </Tooltip>

        {/* 编辑 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => actions.onEdit(task)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>

        {/* 删除 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => actions.onDeleteRequest(task)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除</TooltipContent>
        </Tooltip>
      </div>
    </li>
  )
}

// ===== TaskManagerPanel =====

export function TaskManagerPanel(): React.ReactElement {
  const [tasks, setTasks] = React.useState<ScheduledTask[]>([])
  const [editing, setEditing] = React.useState<ScheduledTask | null | 'new'>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<ScheduledTask | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const refresh = React.useCallback(async (): Promise<void> => {
    try {
      const list = await window.electronAPI.scheduledTasks.list()
      setTasks(list)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`加载失败: ${msg}`)
    }
  }, [])

  // 挂载时加载
  React.useEffect(() => { void refresh() }, [refresh])

  // window focus 时刷新
  React.useEffect(() => {
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const handleRunNow = React.useCallback(async (id: string): Promise<void> => {
    await window.electronAPI.scheduledTasks.runNow(id)
    await refresh()
  }, [refresh])

  const handlePause = React.useCallback(async (id: string): Promise<void> => {
    await window.electronAPI.scheduledTasks.pause(id)
    await refresh()
  }, [refresh])

  const handleResume = React.useCallback(async (id: string): Promise<void> => {
    await window.electronAPI.scheduledTasks.resume(id)
    await refresh()
  }, [refresh])

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await window.electronAPI.scheduledTasks.delete(deleteTarget.id)
      toast.success(`已删除「${deleteTarget.name}」`)
      setDeleteTarget(null)
      await refresh()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`删除失败: ${msg}`)
    } finally {
      setDeleting(false)
    }
  }

  const actions: TaskRowAction = React.useMemo(() => ({
    onRunNow: handleRunNow,
    onPause: handlePause,
    onResume: handleResume,
    onEdit: setEditing,
    onDeleteRequest: setDeleteTarget,
  }), [handleRunNow, handlePause, handleResume])

  return (
    <div className="border-b border-border/40 bg-muted/10 px-4 py-3 shrink-0">
      {/* 头部 */}
      <header className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-foreground/80">定时任务</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => setEditing('new')}
        >
          <Plus className="size-3.5" />
          新建
        </Button>
      </header>

      {/* 任务列表 */}
      {tasks.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3 text-center">
          还没有定时任务。点击「新建」或在对话中告诉 agent "帮我每天 X 时 Y"
        </div>
      ) : (
        <ul className="space-y-0.5">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} actions={actions} />
          ))}
        </ul>
      )}

      {/* 创建/编辑对话框 */}
      {editing !== null && (
        <TaskEditDialog
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh() }}
        />
      )}

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除任务「{deleteTarget?.name}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? '删除中...' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
