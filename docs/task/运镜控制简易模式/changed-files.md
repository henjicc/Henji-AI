# 运镜控制简易模式 · 改动文件清单

## 2.3 过渡细节层面板

### 新增

- `src/features/cameraStage/simple/TransitionDetailPanel.tsx`：过渡抽屉、差异对象列表与空态。
- `src/features/cameraStage/simple/TransitionObjectRow.tsx`：速度、延迟、摄像机预设参数、角色动作覆盖行。

### 修改

- `src/features/cameraStage/domain/shotCompiler.ts`：导出与编译口径一致的 `diffShotObjects`。
- `src/features/cameraStage/simple/ShotTimelinePanel.tsx`：接入默认收起的过渡入口和下方详情抽屉，写回 `updateShotTransition`。
- `docs/task/运镜控制简易模式/` 内任务总览、五类记录与 2.3 任务文件：同步状态、决策、交接和验证记录。

## 1.1 简易模式数据模型与工程持久化

### 新增

- `src/features/cameraStage/domain/shotTypes.ts`（236 行）：`StageEditorMode`、`StageShotObjectState`、`StageSpeedPreset`、`StageCameraMove`、`StageShotTransitionObjectDetail`、`StageShotTransition`、`StageShot`、`StageCameraEffector` 类型定义；`captureShotObjectState`/`createShot`/`normalizeShots`/`normalizeEditorMode` 纯函数。

### 修改

- `src/features/cameraStage/domain/sceneTypes.ts`：`StageCameraObject` 新增 `effectors: StageCameraEffector[]`；`StageObjectPatch` 新增可选 `effectors?: StageCameraEffector[]`。
- `src/features/cameraStage/domain/sceneDefaults.ts`：`createCameraObject` 返回对象补 `effectors: []`。
- `src/features/cameraStage/domain/sceneSerialization.ts`：`CAMERA_STAGE_SCENE_SCHEMA_VERSION` 10 → 11；`StageSceneSnapshot`/`StageSceneSnapshotInput` 新增 `editorMode`/`shots`；`serializeScene` 写入新字段；新增 `withDefaultCameraEffectors` 迁移函数；`deserializeScene` 解析 `editorMode`/`shots`（v10 及以下回退 `'pro'`/`[]`）；文件头注释追加 v11 说明。
- `src/features/cameraStage/projects/cameraStageProjectService.ts`：`createCurrentProjectDraft` 序列化时带上 `editorMode`/`shots`；`loadProjectIntoScene` 加载快照时透传 `editorMode`/`shots` 给 `loadSnapshot`。
- `src/features/cameraStage/store/cameraStageStore.ts`：`CameraStageState` 新增字段 `editorMode: StageEditorMode`（默认 `'simple'`）、`shots: StageShot[]`（默认 `[]`）；`newScene` 重置这两个字段；`loadSnapshot` 从快照回填（缺失时回退 `'pro'`/`[]`）。未新增任何 action/setter。

### 临时文件（已删除，不在最终提交中）

- `src/features/cameraStage/domain/__tmp_verify_v11__.ts`：用于验证 v10→v11 迁移与 v11 往返序列化的一次性脚本，验证通过后已删除。

## 1.2 快照差异编译器

### 新增

- `src/features/cameraStage/domain/shotCompiler.ts`（249 行）：`compileShotsToAnimation(shots, objects)` 纯函数编译器，内含时间轴布点、差异检测、关键帧生成、速度预设映射、错峰延迟钳制、停留段守护点；为 1.3/1.4 预留 TODO 扩展点。
- `src/features/cameraStage/domain/shotCompiler.test.ts`（214 行，13 个用例）：单元测试，覆盖任务要求的全部 6 类场景 + propertyPath 全量校验/缺快照综合用例。
- `vitest.config.ts`：最小 vitest 配置（`include: ['src/**/*.test.ts']` + `@/` alias）。

### 修改

- `package.json`：`devDependencies` 新增 `vitest@^1.6.1`；`scripts` 新增 `"test": "vitest run"`。

## 1.3 摄像机运镜预设编译

### 新增

- `src/features/cameraStage/domain/shotCameraMovePresets.ts`（207 行）：运镜预设几何与采样纯函数。导出 `compileCameraMoveSamples`（统一入口）、`CameraMoveKeyframePoint` 类型、`ORBIT_DEGREES_PER_KEYFRAME`/`STAGE_CAMERA_MOVE_DEFAULTS` 常量；内部实现 `orbitSamples`/`dollySamples`/`truckSamples`/`craneSamples` 与向量数学（`addVec3`/`subVec3`/`scaleVec3`/`rotateAroundY`）、缓动数值反解（`invertEasing`）。
- `src/features/cameraStage/domain/shotCameraMovePresets.test.ts`（165 行，10 个用例）：orbit 半径恒定/角度差/采样密度/方向/退化、dolly 距离比例、truck 正交性、crane 升降、时间重映射（easeInOut 非均匀/linear 均匀）。

### 修改

- `src/features/cameraStage/domain/shotTypes.ts`（237→260 行）：`StageCameraMove` 判别联合从骨架（`direct`/`orbit`/`dollyIn`/`dollyOut`，dolly 无参数）扩展为定稿版（`dollyIn`/`dollyOut` 补 `distanceRatio` 参数；新增 `truck: { offset }`、`crane: { height }`）；`normalizeCameraMove` 同步扩展解析与安全兜底。
- `src/features/cameraStage/domain/shotCompiler.ts`（249→341 行）：新增 `isCameraPositionAxisPath`/`isCameraPositionMoveGroup`/`compileCameraPositionGroup`/`resolveShotLookAtTarget` 四个函数；`compileTransitionPoints` 增加 `propertyPath` 参数与防御性断言（详见 decisions.md）；`compileObjectTransition` 增加可选参数 `cameraLookAtTarget?: StageVec3`，分组循环内对摄像机 `transform.position` 分组做特殊拦截；`compileShotsToAnimation` 主循环内新增 `cameraLookAtTarget` 解析与透传。原 TODO(1.3) 注释已替换为指向新函数的说明。
- `src/features/cameraStage/domain/shotCompiler.test.ts`（214→271 行，13→15 个用例）：新增 `describe('摄像机运镜预设接入（1.3）')` 块，含 2 个集成用例（orbit 编译产物几何验证、fov 变化不受运镜预设误伤）。

## 1.4 角色自动走跑与朝向推断

### 新增

- `src/features/cameraStage/domain/characterTransitionInference.ts`：角色位移、速度分级、朝向最短路径与覆盖动作推断纯函数。
- `src/features/cameraStage/domain/characterTransitionInference.test.ts`：速度边界、低速阈值、跨 ±180°、motionOverride 共 6 个用例。

### 修改

- `src/features/cameraStage/domain/animationTypes.ts`：新增 `StageCharacterMotionScheduleEntry`、`motionSchedule` 与 `resolveCharacterMotionAtTime`。
- `src/features/cameraStage/domain/sceneSerialization.ts`：动画宽松解析补 motionSchedule 兼容回退。
- `src/features/cameraStage/domain/shotCompiler.ts`：接入角色推断、朝向轨道和动作时间表。
- `src/features/cameraStage/domain/shotCompiler.test.ts`：新增角色编译集成用例。
- `src/features/cameraStage/scene/CharacterModel.tsx`：按播放头消费时间表并以区间起点作为动作 seek 原点。
- `docs/task/运镜控制简易模式/` 下计划与五类任务记录：同步 1.4 完成状态、设计决策、测试与交接。

## 2.1 简易模式 store 分片与自动记录

### 新增

- `src/features/cameraStage/store/shotSlice.ts`（181 行）：镜头卡动作、自动记录/编译与对象同步辅助函数，结构化 debug 日志。
- `src/features/cameraStage/store/shotSlice.test.ts`：4 个 store 集成用例。

### 修改

- `src/features/cameraStage/store/cameraStageStore.ts`：接入 slice、自动记录分叉、对象结构同步、默认首卡、zundo 跟踪扩展。
- `docs/task/运镜控制简易模式/` 下 2.1 任务文件、总览与五类任务记录：同步完成状态、决策、测试和交接。

## 2.2 镜头卡时间轴面板

- 新增 `simple/ShotTimelinePanel.tsx`、`ShotCard.tsx`、`shotTimelineUtils.ts`、`shotTimelineUtils.test.ts`。
- 修改 `shotCompiler.ts` 导出布点函数；`PlaybackControls.tsx` 抽共用播放按钮；`CameraStageDock.tsx` 按模式切换。
- 修改 `cameraStageStore.ts`、`shotSlice.ts` 新增 `updateShotName`；同步本任务目录内总览、任务和五类记录。
- 修改 `cameraStageStore.ts`、`PlaybackControls.tsx`、`ShotTimelinePanel.tsx` 的播放可用性策略，并在 `shotSlice.test.ts` 新增零轨道简易播放/专业禁用回归测试。

## 2.4 工程模式接入与专业功能收敛

### 新增

- `src/features/cameraStage/simple/EditorModeBadge.tsx`：编辑器顶栏模式徽标与 3.2 禁用占位入口。

### 修改

- `src/features/cameraStage/projects/cameraStageProjectService.ts`：创建服务接收模式、初始化简易首卡并记录结构化日志。
- `src/features/cameraStage/projects/CameraStageProjectList.tsx`：新建工程模式选择弹窗。
- `src/features/cameraStage/CameraStageEditor.tsx`：接入模式徽标（仅 2 行增量）。
- `src/features/cameraStage/timeline/KeyframeStopwatch.tsx`：简易模式统一隐藏码表。
- `src/features/cameraStage/store/shotSlice.ts`：允许同模式但空卡的简易工程初始化首卡。
- `src/features/cameraStage/store/shotSlice.test.ts`：新增简易工程首卡初始化回归用例。
- `docs/task/运镜控制简易模式/`：更新 2.4 任务、总览及五类记录。

## 3.1 摄像机效果器

### 新增

- `src/features/cameraStage/domain/cameraEffectors.ts`：确定性摄像机效果器采样纯函数。
- `src/features/cameraStage/domain/cameraEffectors.test.ts`：确定性、零强度与频率测试。

### 修改

- `src/features/cameraStage/store/playbackAppliers.ts`：applier 增加精确采样时间参数。
- `src/features/cameraStage/scene/StagePlaybackDriver.tsx`：效果器摄像机逐帧下发基础/采样位置。
- `src/features/cameraStage/scene/StageViewportCamera.tsx`：对真实取景相机叠加确定性局部偏移。
- `src/features/cameraStage/panels/CameraSettingsSection.tsx`：增加效果器参数 UI。
- `docs/task/运镜控制简易模式/`：更新 3.1 任务、总览、重要记录及五类任务记录。
