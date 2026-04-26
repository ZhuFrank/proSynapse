/**
 * TaskEditDialog — 定时任务创建/编辑对话框
 *
 * 支持三种触发类型：cron / 一次性 / 间隔
 * channel/model 从 agentChannelIdAtom/agentModelIdAtom 取默认值
 */

import * as React from 'react'
import { toast } from 'sonner'
import { useAtomValue } from 'jotai'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { agentChannelIdAtom, agentModelIdAtom } from '@/atoms/agent-atoms'
import { channelsAtom } from '@/atoms/chat-atoms'
import type { ScheduledTask, Trigger } from '@proma/shared'

interface TaskEditDialogProps {
  /** null = 创建，ScheduledTask = 编辑 */
  task: ScheduledTask | null
  onClose: () => void
  onSaved: () => void
}

type TriggerType = 'cron' | 'once' | 'interval'
type IntervalUnit = 'minutes' | 'hours' | 'days'

const UNIT_MS: Record<IntervalUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
}

/** 将 everyMs 转换为数值+单位 */
function msToUnitValue(ms: number): { value: number; unit: IntervalUnit } {
  if (ms % UNIT_MS.days === 0) return { value: ms / UNIT_MS.days, unit: 'days' }
  if (ms % UNIT_MS.hours === 0) return { value: ms / UNIT_MS.hours, unit: 'hours' }
  return { value: ms / UNIT_MS.minutes, unit: 'minutes' }
}

/** 将 Unix timestamp(ms) 转 datetime-local 值 */
function tsToDatetimeLocal(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TaskEditDialog({ task, onClose, onSaved }: TaskEditDialogProps): React.ReactElement {
  const defaultChannelId = useAtomValue(agentChannelIdAtom)
  const defaultModelId = useAtomValue(agentModelIdAtom)
  const channels = useAtomValue(channelsAtom)

  // 基础字段
  const [name, setName] = React.useState(task?.name ?? '')
  const [prompt, setPrompt] = React.useState(task?.prompt ?? '')

  // 渠道/模型选择
  const [channelId, setChannelId] = React.useState(task?.channelId ?? defaultChannelId ?? '')
  const [modelId, setModelId] = React.useState(task?.modelId ?? defaultModelId ?? '')

  // trigger type
  const [triggerType, setTriggerType] = React.useState<TriggerType>(() => {
    if (!task) return 'interval'
    return task.trigger.type
  })

  // cron 字段
  const [cronExpr, setCronExpr] = React.useState(() => {
    if (task?.trigger.type === 'cron') return task.trigger.expression
    return '0 9 * * *'
  })

  // 一次性字段
  const [onceAt, setOnceAt] = React.useState(() => {
    if (task?.trigger.type === 'once') return tsToDatetimeLocal(task.trigger.runAt)
    // 默认明天此时
    const tomorrow = new Date(Date.now() + 86_400_000)
    return tsToDatetimeLocal(tomorrow.getTime())
  })

  // 间隔字段
  const [intervalValue, setIntervalValue] = React.useState(() => {
    if (task?.trigger.type === 'interval') return msToUnitValue(task.trigger.everyMs).value
    return 30
  })
  const [intervalUnit, setIntervalUnit] = React.useState<IntervalUnit>(() => {
    if (task?.trigger.type === 'interval') return msToUnitValue(task.trigger.everyMs).unit
    return 'minutes'
  })

  const [submitting, setSubmitting] = React.useState(false)

  // 当渠道变化时重置模型
  const selectedChannel = channels.find((c) => c.id === channelId)
  const availableModels = React.useMemo(
    () => selectedChannel?.models.filter((m) => m.enabled) ?? [],
    [selectedChannel]
  )

  // 可用渠道：enabled 且有模型
  const availableChannels = channels.filter((c) => c.enabled && c.models.some((m) => m.enabled))

  React.useEffect(() => {
    // 如果当前 modelId 在新渠道里不存在，自动选第一个可用模型
    if (channelId && availableModels.length > 0) {
      const modelExists = availableModels.some((m) => m.id === modelId)
      if (!modelExists) {
        setModelId(availableModels[0]!.id)
      }
    }
  }, [channelId, availableModels, modelId])

  const buildTrigger = (): Trigger => {
    if (triggerType === 'cron') {
      return { type: 'cron', expression: cronExpr.trim() }
    }
    if (triggerType === 'once') {
      return { type: 'once', runAt: new Date(onceAt).getTime() }
    }
    return { type: 'interval', everyMs: intervalValue * UNIT_MS[intervalUnit] }
  }

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim()) { toast.error('请填写任务名称'); return }
    if (!prompt.trim()) { toast.error('请填写任务提示词'); return }
    if (!channelId) { toast.error('请选择渠道'); return }
    if (!modelId) { toast.error('请选择模型'); return }
    if (triggerType === 'once' && new Date(onceAt).getTime() <= Date.now()) {
      toast.error('执行时间必须在未来')
      return
    }

    setSubmitting(true)
    try {
      const trigger = buildTrigger()
      if (task) {
        await window.electronAPI.scheduledTasks.update(task.id, {
          name: name.trim(),
          prompt: prompt.trim(),
          trigger,
          channelId,
          modelId,
        })
        toast.success('任务已更新')
      } else {
        await window.electronAPI.scheduledTasks.create({
          name: name.trim(),
          prompt: prompt.trim(),
          trigger,
          channelId,
          modelId,
        })
        toast.success('任务已创建')
      }
      onSaved()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`保存失败: ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{task ? '编辑定时任务' : '新建定时任务'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* 名称 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-name">任务名称</Label>
            <Input
              id="task-name"
              placeholder="例如：每天早报"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* 提示词 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-prompt">提示词</Label>
            <Textarea
              id="task-prompt"
              placeholder="输入 agent 将要执行的任务描述..."
              className="min-h-[80px] resize-none"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          {/* 触发方式 */}
          <div className="flex flex-col gap-1.5">
            <Label>触发方式</Label>
            <Select value={triggerType} onValueChange={(v) => setTriggerType(v as TriggerType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="interval">间隔执行</SelectItem>
                <SelectItem value="cron">Cron 表达式</SelectItem>
                <SelectItem value="once">一次性</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 触发子表单 */}
          {triggerType === 'cron' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cron-expr">Cron 表达式</Label>
              <Input
                id="cron-expr"
                placeholder="例如：0 9 * * *（每天 9:00）"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                示例：<code>*/30 * * * *</code>（每 30 分钟）、
                <code>0 9 * * 1-5</code>（工作日 9:00）、
                <code>0 8 * * *</code>（每天 8:00）
              </p>
            </div>
          )}

          {triggerType === 'once' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="once-at">执行时间</Label>
              <Input
                id="once-at"
                type="datetime-local"
                value={onceAt}
                onChange={(e) => setOnceAt(e.target.value)}
              />
            </div>
          )}

          {triggerType === 'interval' && (
            <div className="flex flex-col gap-1.5">
              <Label>执行间隔</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  className="w-24"
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(Math.max(1, Number(e.target.value)))}
                />
                <Select value={intervalUnit} onValueChange={(v) => setIntervalUnit(v as IntervalUnit)}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">分钟</SelectItem>
                    <SelectItem value="hours">小时</SelectItem>
                    <SelectItem value="days">天</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* 渠道选择 */}
          <div className="flex flex-col gap-1.5">
            <Label>渠道</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger>
                <SelectValue placeholder="选择渠道..." />
              </SelectTrigger>
              <SelectContent>
                {availableChannels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 模型选择 */}
          <div className="flex flex-col gap-1.5">
            <Label>模型</Label>
            <Select value={modelId} onValueChange={setModelId} disabled={availableModels.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="选择模型..." />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '保存中...' : task ? '保存更改' : '创建任务'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
