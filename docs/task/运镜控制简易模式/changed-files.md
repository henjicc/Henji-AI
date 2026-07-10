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
