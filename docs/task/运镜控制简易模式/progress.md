# 运镜控制简易模式 · 进度记录

## 1.1 简易模式数据模型与工程持久化 —— 已完成

- 日期：2026-07-10
- 新建 `src/features/cameraStage/domain/shotTypes.ts`：`StageEditorMode`、`StageShotObjectState`、`StageSpeedPreset`、`StageCameraMove`、`StageShotTransition`（含 `StageShotTransitionObjectDetail`）、`StageShot`、`StageCameraEffector` 类型；`captureShotObjectState`/`createShot`/`normalizeShots`/`normalizeEditorMode` 纯函数（236 行）。
- `sceneTypes.ts`：`StageCameraObject` 增加 `effectors: StageCameraEffector[]`；`StageObjectPatch` 增加可选 `effectors`。
- `sceneDefaults.ts`：`createCameraObject` 补默认 `effectors: []`。
- `sceneSerialization.ts`：`CAMERA_STAGE_SCENE_SCHEMA_VERSION` 10 → 11；快照类型/`serializeScene`/`deserializeScene` 并入 `editorMode`、`shots`；新增 `withDefaultCameraEffectors` 迁移函数；v10 及以下加载时 `editorMode='pro'`、`shots=[]`、摄像机补空 `effectors`；高于 v11 仍报错。
- `cameraStageProjectService.ts`、`store/cameraStageStore.ts`：`createCurrentProjectDraft`/`loadProjectIntoScene`/`newScene`/`loadSnapshot` 透传 `editorMode`/`shots`；store 新增最小字段 `editorMode`（默认 `'simple'`）、`shots`（默认 `[]`），不建动作/setter（留给 2.1）。
- 验证：用临时 esbuild 打包 + node 执行的脚本（用后即删）跑通 v10→v11 迁移、v11 往返序列化、`captureShotObjectState`/`normalizeShots` 边界，共 21 项断言全部通过。
- 检查：`npm run lint`、`npx tsc -p tsconfig.json`、`npx tsc -p tsconfig.electron.json --noEmit` 均无输出、无报错。
- 遗留：无。下一任务 1.2 可直接消费 `shotTypes.ts` 与 store 的 `editorMode`/`shots` 字段。
