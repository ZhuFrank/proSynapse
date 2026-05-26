# 本地定时任务（Local Scheduled Tasks）

Proma 的本地定时任务模块允许你创建周期性 / 一次性 / 间隔性的 agent 自动执行任务。
所有任务在用户本机的 Electron 进程内调度，**不依赖任何云端服务**。

## 三种触发方式

| 类型 | 字段 | 说明 |
|---|---|---|
| `cron` | `expression: string`, `timezone?: string` | 标准 cron 表达式，如 `0 8 * * *` 表示每天 8 点 |
| `once` | `runAt: number`（Unix ms） | 一次性，到时执行一次后自动 disable |
| `interval` | `everyMs: number`, `startAt?: number`（Unix ms） | 简单间隔，每 N 毫秒触发一次 |

## 使用方式

### 1. 通过 UI 创建（推荐普通用户）

打开侧边栏顶部的"系统 / ⏰ 定时任务"会话，点击 +新建，填写表单（name / prompt / 触发方式 / channel / model）保存即可。

### 2. 通过 agent 自然语言创建（推荐 power user）

在任意 agent 会话中说"帮我每天早上 8 点把昨天 GitHub trending 总结发出来"。Agent 会调本地工具 `schedule_task` 创建任务，**不会**建议任何云端调度方案。

支持的 agent 工具：
- `schedule_task` —— 创建
- `list_scheduled_tasks` —— 查看
- `cancel_scheduled_task` —— 删除
- `pause_scheduled_task` / `resume_scheduled_task` —— 暂停 / 启用
- `update_scheduled_task` —— 修改
- `run_scheduled_task_now` —— 立即触发

## 触发后发生什么

每次到时点：
1. 系统创建一个临时 sub-session（命名 `[定时] {任务名} @ {时间}`）跑 agent 完整对话
2. agent 执行完毕，结果以"用户问题 + assistant 回复"两条消息追加到固定的"定时任务"系统会话
3. UI 上你可以在系统会话里看到所有任务的执行历史

## 端到端冒烟测试步骤（开发者）

1. 启动应用：`cd /Users/frank/Documents/Applications/proma/Proma && bun run dev`

2. **方式一：DevTools 控制台直接调 IPC（不依赖 UI）**
   打开 DevTools，跑：
   ```js
   const channelId = 'YOUR_CHANNEL_ID'  // 在右上角 channel 选择器里看
   const modelId = 'YOUR_MODEL_ID'

   // 创建一个每分钟触发的 interval 任务
   const task = await window.electronAPI.scheduledTasks.create({
     name: '冒烟测试-interval',
     prompt: '说 hi',
     trigger: { type: 'interval', everyMs: 60000 },
     channelId,
     modelId,
   })
   console.log('Created:', task)

   // 等 60 秒，去侧边栏顶部看"系统/定时任务"会话有没有新增的两条消息
   ```

3. **方式二：UI 创建任务**
   侧边栏 → "系统 / ⏰ 定时任务" → 点击 +新建 → 填表 → 保存。

4. **三种 trigger 都验证一遍：**
   - cron: `*/2 * * * *`（每 2 分钟），观察 3 次触发后停止
   - once: 用 datetime-local 选 30 秒后的时间，观察触发后任务自动 disable + nextRunAt 清空
   - interval: 60_000 ms（每分钟），观察规律触发

5. **重启验证持久化：** 创建任务后完全 quit 应用（Cmd+Q），再启动，观察 main 进程日志 `[调度器] 排队 ...`，并去侧边栏看任务还在。

6. **Agent 自然语言验证（核心）：** 在普通 agent 会话发：
   > "帮我每分钟说一次 hi 给我看下能不能用"
   
   验证：
   - ✅ Agent 应该调 `schedule_task` 工具
   - ❌ Agent **不应该**说"我无法执行定时任务"或建议 GitHub Actions / cron / Anthropic Managed / 飞书机器人等云端方案
   - 触发后，"定时任务"系统会话应该自动出现新消息

7. **状态字段：** 在 UI 任务面板上，确认 `nextRunAt` 显示正确、`lastRunAt` / `lastRunStatus` 在每次触发后更新。

## 已知限制

- **应用退出期间不补跑：** 如果电脑关机或应用未启动，错过的触发不会补跑。下次启动只按当前时间重新排队。
- **macOS 应用未启动也不能跑：** 当前不集成 launchd / 系统级守护，定时任务依赖应用进程。
- **sub-session 累积：** 每次触发都会新建一个 sub-session（出现在侧边栏，但不在系统会话分区）。长时间运行的高频任务会产生大量历史会话；后续可考虑加自动归档。

## 数据存储位置

- 任务列表：`~/.proma/scheduled-tasks.json`（开发模式：`~/.proma-dev/scheduled-tasks.json`）
- 系统会话 id：存储在 `~/.proma/settings.json` 的 `scheduledTaskSystemSessionId` 字段
- 每次触发的详细日志：`~/.proma/agent-sessions/{sub-session-id}.jsonl`

## 故障排查

- **任务创建后没触发：** 看主进程日志 `[调度器]` 前缀的输出。如果有 `cron 解析失败` 字样，说明 cron 表达式无效。
- **agent 建议云端方案：** Confirm Task 7 system prompt + MCP server 都已生效（重启应用让 agent-orchestrator 重新加载）。
- **重启后任务消失：** 检查 `~/.proma/scheduled-tasks.json` 是否存在 + JSON 是否合法。
