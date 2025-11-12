## 目标
- 进度条与轮询节奏同步，采用减速曲线（前期快、后期慢），更贴近真实等待体验（约 60 次内常出结果）。
- 不依赖后端 progress 字段，纯装饰；任务成功时直接 100%。
- 达到 120 次仍处于 PROCESSING/QUEUED 时，提示“轮询超时”，提供“再次轮询 120 次”按钮，基于已有 task_id 继续查询，不重新提交生成。

## 进度曲线
- 曲线：ease-out（减速）
  - 公式：`p = 95 * (1 - (1 - t)^3)`，`t = pollCount / maxPolls`，向上取整并封顶 95。
  - 每次轮询更新：`next = min(95, max(prev + 1, round(p)))`，保证至少 +1%。
  - 成功时：直接置 `progress = 100`。

## UI 动画
- 进度条宽度动画：添加 CSS 过渡，实现“丝滑”效果。
  - 在进度条填充元素上添加：`transition-[width] duration-[2800ms] ease-out`（或 `transition-all duration-[2800ms] ease-out`），与 3s 轮询间隔匹配，避免跳变。
  - 百分比文案照旧显示 `Math.floor(progress)%`。

## 超时与重试
- 超时定义：`pollCount >= 120` 且状态为 `TASK_STATUS_PROCESSING` 或 `TASK_STATUS_QUEUED`。
- 处理：
  - 不抛错、不标记 error。
  - 在对应任务标记 `timedOut = true`，保留 `status = 'generating'`、保留当前 `progress`。
  - 在“生成中”卡片中显示提示文案：“轮询超时，可再次轮询 120 次”，并提供按钮。
- 重试按钮行为：
  - 使用该任务保存的 `serverTaskId` 重新调用轮询函数 `pollTaskStatus(serverTaskId, uiTaskId, model)`，不重新提交生成。
  - 点击后清除 `timedOut`，进度继续按减速曲线单调递增（从当前 `progress` 继续，算法仍为 `max(prev + 1, stepTarget)`，不回退）。

## 代码改动点
- `src/App.tsx`
  1) 类型与任务结构
  - 扩展 `GenerationTask`：`progress?: number`（已存在）、新增 `serverTaskId?: string`、`timedOut?: boolean`。
  - 创建新任务时初始化：`progress: 0, timedOut: false`。
  2) 发起视频生成
  - 在拿到 `result.taskId` 后，先将该任务写入 `serverTaskId`，再开始轮询：`pollTaskStatus(result.taskId, taskId, model)`。
  3) 轮询函数 `pollTaskStatus(serverTaskId, uiTaskId, model)`
  - `maxPolls = 120`（vidu-q1）。
  - 每 tick：计算 `t = pollCount/maxPolls`，`stepTarget = round(95 * (1 - (1 - t)^3))`，然后 `next = min(95, max(prev + 1, stepTarget))`，仅对 `vidu-q1` 更新对应任务的 `progress`。
  - 成功：`progress = 100`，`resolve(result)`。
  - 失败：抛错（保持现有逻辑）。
  - 超时且仍 PROCESSING/QUEUED：清除 interval，设置该任务 `timedOut = true`，`resolve(null)`（调用方识别为未完成）。
  4) 调用方处理
  - 若 `pollTaskStatus` 返回 `null`（超时），不改为 success/error，保持 `status = 'generating'`，并显示重试 UI。
  5) UI 渲染
  - “生成中”卡片：
    - 进度条填充元素添加动画 class（`transition-[width] duration-[2800ms] ease-out`）。
    - 当 `task.timedOut` 为 true：显示“轮询超时”提示与“再次轮询 120 次”按钮，点击后调用重试函数（再次调用 `pollTaskStatus(task.serverTaskId!, task.id, task.model)`），并将 `timedOut` 置回 false。

## 校验与回归
- 验证 Vidu Q1 三个入口（文/图生、首尾帧、参考生）均能：
  - 正常显示减速进度动画；
  - 约 60 次内完成时，进度自然跃至 100%；
  - 超时后显示按钮，点击后继续轮询且不重新提交；
  - 成功后历史记录保存不变，视频可正常播放。

## 兼容与风险
- 不依赖后端 `progress_percent`，避免不同接口表现不一致。
- 仅在 `vidu-q1` 下应用减速与超时重试逻辑，不影响其他模型。
- 若需细调“60 次左右达到 85–90%”体验，可将指数从 3 调为 2 或 2.5 进行微调。

请确认以上方案，我将据此实现代码修改与验证。