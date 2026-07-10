# 运镜控制简易模式 · 改动文件清单

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
