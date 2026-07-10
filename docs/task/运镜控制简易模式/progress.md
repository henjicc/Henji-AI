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

## 1.3 摄像机运镜预设编译 —— 已完成

- 日期：2026-07-10
- 定稿 `StageCameraMove` 判别联合（`shotTypes.ts`）：一期实现全部 5 种预设——`direct`（两点直插，已有）、`orbit`（`degrees` + `direction: 'cw'|'ccw'`，绕世界 Y 轴环绕）、`dollyIn`/`dollyOut`（`distanceRatio`，沿"机位→目标"连线缩放距离）、`truck`（`offset`，水平面内垂直视线方向横移）、`crane`（`height`，沿世界 Y 轴升降）。`normalizeCameraMove` 同步更新，非法值均有安全兜底。
- 新建 `src/features/cameraStage/domain/shotCameraMovePresets.ts`（207 行）：纯函数几何实现。`compileCameraMoveSamples(move, fromPosition, targetPosition, segStart, segEnd, easing)` 为统一入口，按 `move.kind` 分派到 `orbitSamples`/`dollySamples`/`truckSamples`/`craneSamples`。orbit 每 ~15° 一个采样点（linear 分段近似圆弧），采样点的时间通过对缓动曲线做数值反解（`invertEasing`，二分法）实现非均匀分布，从而在角度均匀采样（保证圆弧近似质量）的同时仍体现整体缓动速度感；dolly/truck/crane 只需首尾两点 + easing。全部为纯数学实现，不依赖 three.js（自实现 `rotateAroundY` 等价于 three.js `Matrix4.makeRotationY` 的旋转约定，但零运行时依赖）。
- 接入 `shotCompiler.ts`：由于环绕/横移等几何需要 X/Y/Z 三分量整体信息，单分量 scalar 签名（原 `compileTransitionPoints` 逐轴调用）无法独立算出正确结果，实际拦截点改在 `compileObjectTransition` 的 `transform.position` 分组循环入口（新增 `isCameraPositionMoveGroup` 判断 + `compileCameraPositionGroup` 一次性算出三分量采样点、写入 x/y/z 三条轨道），而不是最初 handoff.md 建议的"在 `compileTransitionPoints` 内部按分量分支"。`compileTransitionPoints` 仍按 handoff 建议新增了 `propertyPath` 参数，但用途从"分支处理"改为"防御性断言"——一旦摄像机运镜位置分量意外流入该函数（说明分组拦截条件被破坏），直接抛错而不是静默退化为错误的两点直插。fov/color 等非位置属性、以及 direct/未设置运镜的摄像机位置分量，行为不变，仍走两点直插。
- 环绕目标点解析：新增 `resolveShotLookAtTarget`，取过渡起始卡（fromShot）快照中的 lookAt 解析结果——`manual` 模式直接用 `lookAt.target`；`object` 模式取目标对象在 `fromShot.objectStates` 快照中的位置（一期简化，不追踪目标自身在本段过渡中的移动，与任务文件"当前情况"约定一致），朝向偏移复用 `cameraUtils.ts` 的 `getObjectLookAtPoint` 同款"角色目标取胸口高度"逻辑（只是取值源换成镜头卡快照而非当前场景对象）。
- 摄像机朝向机制验证：读 `scene/StageViewportCamera.tsx` 确认——摄像机朝向由 `camera.lookAt(lookAtTarget)` 在每次位置采样回调（`registerPlaybackApplier('transform.position', ...)`）与初始 `useLayoutEffect` 中实时计算，不读取任何 `transform.rotation` 关键帧轨道；且 `animatableProps.ts` 的 `TRANSFORM_GROUPS` 对 `rotation`/`scale` 分组用 `notCamera` 过滤，摄像机对象本就没有这两个分组的轨道。handoff.md 给出的结论（"朝向由 lookAt 驱动，只需生成位置关键帧"）验证无误、未过时，因此本任务只生成位置关键帧，未涉及旋转轨道。
- 环绕终点语义（重要记录 003）定稿：选了环绕/其他非 direct 预设后，本段过渡摄像机终点由几何计算决定，覆盖/忽略 B 卡摆放的机位（不做"UI 自动吸附机位"这类交互层方案，一期只在编译层覆盖）。该决策统一应用到 orbit/dollyIn/dollyOut/truck/crane 全部 5 种预设，而不仅是 orbit——设计原则是"只要选了非 direct 运镜，几何计算即为唯一权威来源"，保持行为一致、避免用户在细节层看到"预设参数和实际渲染对不上"的错觉。
- 新建单元测试 `shotCameraMovePresets.test.ts`（165 行，10 个用例）+ `shotCompiler.test.ts` 新增 2 个集成用例：覆盖 orbit 180° 半径恒定/角度差 180°、~15° 采样密度、cw/ccw 方向相反、degrees=0 退化、dollyIn/dollyOut 距离比例、truck 横移正交性、crane 升降、easeInOut 时间重映射非均匀、linear 时间重映射均匀、编译集成（orbit 产物可被 `sampleTrack` 采样且弦-弧误差在容差内、B 卡机位被几何覆盖）、fov 变化不受运镜预设误伤。
- 验证：`npm run test`（25/25 通过，含 1.2 遗留 13 个用例全部仍通过）、`npm run lint`（通过）、`npx tsc --noEmit`（前端，通过）、`npx tsc -p tsconfig.electron.json --noEmit`（通过）。
- 遗留：无功能性遗留，5 种预设（含 direct）全部实现。2.3（细节层 UI）需要暴露 `StageCameraMove` 全部参数（orbit 的 degrees/direction、dolly 的 distanceRatio、truck 的 offset、crane 的 height），详见 handoff.md。
