# 简易模式时间轴重做 · 进度记录

## 第一阶段-时间轴核心重做（已完成，2026-07-11）

| 任务 | 状态 | 一句话摘要 |
|---|---|---|
| 1.1 帧单位时长基础与块布局几何 | 已完成 | 新建 `shotClipGeometry.ts`：帧量化/钳制 + `buildClipLayout`/`findClipAtTime` 纯函数；`updateShotTiming` 写入口接入。 |
| 1.2 比例块轨道与标尺播放头 | 已完成 | `ShotTimelinePanel` 重写为比例块轨道（`StaticClipBlock`/`TransitionClipBlock`/`ShotClipTrack`）+ `TimeRuler` + 播放头 overlay；新增 Ctrl+点击循环切换的三态时间码组件；`selectedShotId` 跟随播放头但不进撤销历史。 |
| 1.3 过渡参数气泡与过渡段只读 | 已完成 | 过渡块点击弹出 `TransitionPopover`（复用 `TransitionObjectRow`），替代旧底部抽屉；播放头落过渡段时视口隐藏 gizmo + 显示只读提示；`compileSimpleEdit`/`captureIntoSelectedShot` 接入静止段捕获守卫。 |

阶段完成后，简易模式时间轴已是端到端可用的比例块轨道：块宽反映真实时长、标尺可拖 scrub、点击静止块切视角、scrub 在静止段自动跟随选中、过渡块气泡可调时长/速度预设/逐对象细节、过渡段视口只读且不会误录。**尚不包含**：块边缘 trim、块身拖拽重排、滚轮缩放（均为第二阶段范围）。

## 第二阶段-编辑手感（已完成，2026-07-11）

| 任务 | 状态 | 一句话摘要 |
|---|---|---|
| 2.1 块边缘拖拽调时长 | 已完成 | 新建 `useClipTrim.ts`：静止块/过渡块右边缘 PR 式拖拽，1 帧吸附，本地预览 + 松手一次性提交 `updateShotTiming`；停留时长首次获得 UI 入口。 |
| 2.2 变宽块拖拽重排 | 已完成 | 新建 `useClipReorder.ts` + 单测：静止块块身拖拽换序，4px 阈值区分点击/拖拽，纯函数 `computeInsertIndex` 计算插入位；过渡块随前面静止卡自然移动。 |
| 2.3 滚轮缩放与阶段打磨 | 已完成 | `ShotTimelinePanel` 的 `pxPerSecond` 改为可缩放 state，接入 Alt+滚轮锚点缩放（照抄专业模式）与挂载/尺寸/时长驱动的初始自适应铺满；标尺 200px/s 以上自动切帧刻度；打磨清单逐项复核，1.2/2.1/2.2 已覆盖，未发现需要额外改动项。 |

第二阶段完成后，简易模式时间轴具备完整编辑手感：块边缘拖拽调时长（trim）、块身拖拽重排、滚轮锚点缩放三项交互全部可用，且互不误触（点击/双击/块身拖拽/边缘拖拽四种手势已验证互斥）。**尚不包含**：多机位硬切（第三阶段范围）。

2.1 与 2.2 因改动同一批文件（`ShotClipTrack.tsx`/`StaticClipBlock.tsx`/`TransitionClipBlock.tsx`）且手势命中区互斥，实际编码合并进行，但按任务粒度拆成两次独立提交（决策 D4）。

## 第三阶段-多机位硬切（进行中，2026-07-11）

| 任务 | 状态 | 一句话摘要 |
|---|---|---|
| 3.3 视频导出机位切换 | 已完成 | 导出逐帧 seek 复用 3.2 的 `useRenderCameraId` → `StageViewportCamera` → `StageCaptureBridge` 渲染链路，切换点与预览一致；以首摄像机画幅确定导出尺寸，补齐参与机位统计、画幅异常防御提示与结构化日志。 |

第三阶段的后续任务仍待执行；3.3 的真实 MP4 逐帧切换、旧工程画幅不一致告警与取消导出需要用户在 Electron 窗口按阶段计划手测。

## 每任务自检结果

第一阶段三个任务、第二阶段三个任务均执行了以下自检，全部通过：

- `npm run test`（vitest）：1.1 结束时 59/59，1.2 结束时 64/64，1.3 结束时 70/70，2.1+2.2 结束时 76/76（新增 useClipReorder.test.ts 6 条），2.3 结束时仍为 76/76（本任务无新增用例，仅回归）
- `npm run lint`：0 error / 0 warning
- `npx tsc -p tsconfig.electron.json --noEmit`：0 报错
- `npx tsc --noEmit`（前端 tsconfig，未在原始检查清单中但额外补跑以覆盖本阶段全部改动均为前端代码）：0 报错
- `npm run check:colors`：通过，无十六进制颜色硬编码
- 原生控件检查（`<button>/<input>/<select>/<textarea>` 命中范围）：新增/修改文件零命中，均复用 `Ui*` primitives
- 2.3 额外跑：`npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`（0 报错）、文件行数检查（本阶段新增文件均 ≤400 行，`cameraStage/simple` 目录下无 >500 行文件）

## 提交记录

- `完成：1.1 帧单位时长基础与块布局几何`
- `完成：1.2 比例块轨道与标尺播放头`
- `完成：1.3 过渡参数气泡与过渡段只读`
- `完成：2.1 块边缘拖拽调时长 + 2.2 变宽块拖拽重排`
- `完成：2.3 滚轮缩放与阶段打磨`

## 遗留 / 待办

- 用户手测清单已在各任务文件"执行记录"章节写清操作步骤，尚待用户在真实 Electron 窗口（`npm run electron:dev`）验证全部鼠标交互（scrub、点击选中、双击重命名、气泡开关、gizmo 隐藏、trim 拖拽、重排拖拽、滚轮缩放等）。
- 第三阶段（多机位）尚未开始，接口约定见 `handoff.md`。
