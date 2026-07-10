# 简易模式时间轴重做 · 变更文件清单（第一阶段：1.1 + 1.2 + 1.3；第二阶段：2.1 + 2.2 + 2.3）

## 第三阶段新增修改（3.3 视频导出机位切换）

```
src/features/cameraStage/CameraStageEditor.tsx          # 按渲染机位时间表统计参与机位；首摄像机画幅导出；旧数据画幅异常提示
src/features/cameraStage/export/cameraStageVideo.ts     # 导出入参补机位统计/画幅异常标记；start/告警结构化日志
src/features/cameraStage/domain/cameraUtils.ts          # 新增参与机位画幅一致性纯校验
src/features/cameraStage/domain/cameraUtils.test.ts     # 新增画幅一致性单测，并修正既有联合类型访问以通过前端 tsc
docs/task/简易模式时间轴重做/任务/第三阶段-多机位硬切/3.3-视频导出机位切换.md
docs/task/简易模式时间轴重做/progress.md
docs/task/简易模式时间轴重做/decisions.md
docs/task/简易模式时间轴重做/handoff.md
docs/task/简易模式时间轴重做/changed-files.md
docs/task/简易模式时间轴重做/test-report.md
```

## 第二阶段新增文件

```
src/features/cameraStage/simple/timeline/useClipTrim.ts        # 2.1：块右边缘 trim 拖拽 hook
src/features/cameraStage/simple/timeline/useClipReorder.ts     # 2.2：块身重排拖拽 hook + computeInsertIndex 纯函数
src/features/cameraStage/simple/timeline/useClipReorder.test.ts # 2.2：computeInsertIndex 单测
```

## 第二阶段修改文件

```
src/features/cameraStage/simple/ShotTimelinePanel.tsx           # 2.2：接入 reorderShot 提交；2.3：pxPerSecond 改 state + 滚轮缩放 + 初始自适应 + 帧刻度切换
src/features/cameraStage/simple/timeline/ShotClipTrack.tsx       # 2.1/2.2：接入 useClipTrim/useClipReorder，本地覆盖布局、浮签、插入指示线
src/features/cameraStage/simple/timeline/StaticClipBlock.tsx     # 2.1/2.2：新增右边缘 trim 命中区、块身重排事件透传，导出 ClipBlockPointerHandlers 类型
src/features/cameraStage/simple/timeline/TransitionClipBlock.tsx # 2.1：新增右边缘 trim 命中区（与 PanelTrigger 兄弟节点叠加）
```

## 第二阶段对应提交

- `完成：2.1 块边缘拖拽调时长 + 2.2 变宽块拖拽重排`
- `完成：2.3 滚轮缩放与阶段打磨`

---

# 第一阶段：1.1 + 1.2 + 1.3

## 新增文件

```
src/features/cameraStage/simple/timeline/shotClipGeometry.ts
src/features/cameraStage/simple/timeline/shotClipGeometry.test.ts
src/features/cameraStage/simple/timeline/shotTimecodeFormat.ts
src/features/cameraStage/simple/timeline/shotTimecodeFormat.test.ts
src/features/cameraStage/simple/timeline/shotTimelineLayout.ts
src/features/cameraStage/simple/timeline/ShotTimecodeText.tsx
src/features/cameraStage/simple/timeline/ShotClipTrack.tsx
src/features/cameraStage/simple/timeline/StaticClipBlock.tsx
src/features/cameraStage/simple/timeline/TransitionClipBlock.tsx
src/features/cameraStage/simple/timeline/TransitionPopover.tsx
src/features/cameraStage/scene/StageTransitionReadOnlyOverlay.tsx
```

## 修改文件

```
src/features/cameraStage/simple/ShotTimelinePanel.tsx     # 整体重写：比例块轨道替代旧固定宽卡片列表
src/features/cameraStage/store/shotSlice.ts                # updateShotTiming 接入钳制/量化；新增 setSelectedShotIdOnly；
                                                             # compileSimpleEdit/captureIntoSelectedShot 接入静止段捕获守卫；
                                                             # addShot 补上播放头跳转（决策 D1）
src/features/cameraStage/store/shotSlice.test.ts            # 新增捕获守卫回归用例
src/features/cameraStage/store/cameraStageStore.ts          # CameraStageState 接口新增 setSelectedShotIdOnly 签名
src/features/cameraStage/scene/StageScene.tsx                # 过渡段隐藏 StageTransformControls（gizmo）
src/features/cameraStage/layout/CameraStageDock.tsx           # ViewportPanel 挂载 StageTransitionReadOnlyOverlay
```

## 删除文件

```
src/features/cameraStage/simple/ShotCard.tsx              # 被 StaticClipBlock 替代（1.2）
src/features/cameraStage/simple/TransitionDetailPanel.tsx  # 被 TransitionPopover 替代（1.3）；TransitionObjectRow.tsx 保留复用
```

## 对应提交

- `完成：1.1 帧单位时长基础与块布局几何`
- `完成：1.2 比例块轨道与标尺播放头`
- `完成：1.3 过渡参数气泡与过渡段只读`
