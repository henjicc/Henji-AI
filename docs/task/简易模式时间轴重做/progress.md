# 简易模式时间轴重做 · 进度记录

## 第一阶段-时间轴核心重做（已完成，2026-07-11）

| 任务 | 状态 | 一句话摘要 |
|---|---|---|
| 1.1 帧单位时长基础与块布局几何 | 已完成 | 新建 `shotClipGeometry.ts`：帧量化/钳制 + `buildClipLayout`/`findClipAtTime` 纯函数；`updateShotTiming` 写入口接入。 |
| 1.2 比例块轨道与标尺播放头 | 已完成 | `ShotTimelinePanel` 重写为比例块轨道（`StaticClipBlock`/`TransitionClipBlock`/`ShotClipTrack`）+ `TimeRuler` + 播放头 overlay；新增 Ctrl+点击循环切换的三态时间码组件；`selectedShotId` 跟随播放头但不进撤销历史。 |
| 1.3 过渡参数气泡与过渡段只读 | 已完成 | 过渡块点击弹出 `TransitionPopover`（复用 `TransitionObjectRow`），替代旧底部抽屉；播放头落过渡段时视口隐藏 gizmo + 显示只读提示；`compileSimpleEdit`/`captureIntoSelectedShot` 接入静止段捕获守卫。 |

阶段完成后，简易模式时间轴已是端到端可用的比例块轨道：块宽反映真实时长、标尺可拖 scrub、点击静止块切视角、scrub 在静止段自动跟随选中、过渡块气泡可调时长/速度预设/逐对象细节、过渡段视口只读且不会误录。**尚不包含**：块边缘 trim、块身拖拽重排、滚轮缩放（均为第二阶段范围）。

## 每任务自检结果

三个任务均执行了以下自检，全部通过：

- `npm run test`（vitest）：1.1 结束时 59/59，1.2 结束时 64/64，1.3 结束时 70/70（全仓库当前仅 `cameraStage` 域有 vitest 用例）
- `npm run lint`：0 error / 0 warning
- `npx tsc -p tsconfig.electron.json --noEmit`：0 报错
- `npx tsc --noEmit`（前端 tsconfig，未在原始检查清单中但额外补跑以覆盖本阶段全部改动均为前端代码）：0 报错
- `npm run check:colors`：通过，无十六进制颜色硬编码
- 原生控件检查（`<button>/<input>/<select>/<textarea>` 命中范围）：新增/修改文件零命中，均复用 `Ui*` primitives

## 提交记录

- `完成：1.1 帧单位时长基础与块布局几何`
- `完成：1.2 比例块轨道与标尺播放头`
- `完成：1.3 过渡参数气泡与过渡段只读`（提交时会包含）

## 遗留 / 待办

- 用户手测清单已在 1.2、1.3 任务文件"执行记录"章节写清操作步骤，尚待用户在真实 Electron 窗口（`npm run electron:dev`）验证鼠标交互（scrub、点击选中、双击重命名、气泡开关、gizmo 隐藏等）。
- 第二阶段（trim/重排/滚轮缩放）与第三阶段（多机位）尚未开始，接口约定见 `handoff.md`。
