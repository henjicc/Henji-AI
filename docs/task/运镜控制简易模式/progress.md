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

## 1.2 快照差异编译器 —— 已完成

- 日期：2026-07-10
- 项目原无测试基建，新增 `vitest@^1.6.1` devDependency + 最小 `vitest.config.ts`（只跑 `src/**/*.test.ts`，含 `@/` alias）+ `package.json` `"test": "vitest run"` 脚本，供 1.3/1.4 等后续任务复用。
- 新建 `src/features/cameraStage/domain/shotCompiler.ts`（249 行）：纯函数 `compileShotsToAnimation(shots, objects) → StageSceneAnimation`。核心流程：`buildShotTimeline` 累加 hold+transitionDuration 布点；逐对象逐属性用 `listAnimatableGroups` + 合并快照到临时对象后调用 `descriptor.getValue` 做差异检测（scalar 容差 1e-3，color 全等）；`compileTransitionPoints` 生成过渡两端关键帧（速度预设→缓动映射：uniform/easeInOut/fastStart/slowStart → linear/easeInOut/easeOut/easeIn）；`applyTransitionDelay` 做错峰延迟平移+钳制；停留段守护点（`holdGuard`）在下一卡 hold>0 且非末段时于自然过渡起点补同值点，防止跨卡插值污染停留段；关键帧去重复用 `keyframeEngine.upsertKeyframe`。摄像机运镜预设（1.3）与角色自动走跑（1.4）的扩展点以 TODO 注释形式留在 `compileTransitionPoints`/`compileObjectTransition` 内。
- 新建 `src/features/cameraStage/domain/shotCompiler.test.ts`（214 行，13 用例）：覆盖任务要求的全部 6 类场景（单属性差异/未变化对象/停留段恒值/四种速度预设/延迟正负超界/空+单卡），另加 1 个 propertyPath 全量注册表校验 + 对象缺快照跳过的综合用例。
- 验证：`npm run test`（13/13 通过）、`npm run lint`（通过）、`npx tsc -p tsconfig.json --noEmit`（通过）、`npx tsc -p tsconfig.electron.json --noEmit`（通过）。
- 遗留：无功能性遗留。1.3（摄像机运镜预设编译）与 1.4（角色自动走跑）可基于本编译器并行开始，详见 handoff.md。
