# 运镜控制简易模式 · 进度记录

## 2.3 过渡细节层面板 —— 已完成

- 日期：2026-07-10
- 编译器导出 `diffShotObjects`，UI 复用可动画属性注册表与差异容差，只展示两卡间真实变化对象。
- `ShotTimelinePanel` 在每个非末卡下提供默认收起的过渡入口，下方抽屉复用原卡片条与播放控件，不复制时间累加逻辑。
- 新增对象详情行：通用速度/延迟；摄像机完整预设参数；角色自动/无动作/内置 clip 覆盖。
- 所有编辑走 `updateShotTransition` 即时重编译；非 direct 运镜显示终点几何权威提示。
- 验证：39/39 测试、lint、前后端 tsc、check:colors、原生控件扫描、diff 检查全部通过。
- 遗留：真实 Electron 点击、播放差异与撤销效果按 `test-report.md` 交给用户手动验收；无静态阻塞。

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

## 1.4 角色自动走跑与朝向推断 —— 已完成

- 日期：2026-07-10
- 新建 `characterTransitionInference.ts`：纯函数推断水平位移平均速度、Walk/Jog/Sprint 动作与朝向关键点；支持跨 ±180° 最短路径和 `motionOverride`。
- `StageSceneAnimation` 新增 `motionSchedule`；编译器为有效角色位移生成四点 rotation.y 转身轨道及临时动作区间，区间结束恢复目标卡 motion。
- `CharacterModel` 按 currentTime 解析 schedule，沿用 `AnimationMixer.setTime` 确定性 seek；未新增 motion 关键帧类型。
- `sceneSerialization.parseAnimation` 对旧动画缺少 schedule 时回退空数组。
- 验证：`npm run test` 32/32、`npm run lint`、前端 tsc、Electron tsc 全通过。
- 遗留：真实角色视口动作需等 2.2 提供镜头卡交互后，由用户按任务文件步骤手动验收。

## 2.1 简易模式 store 分片与自动记录 —— 已完成

- 日期：2026-07-10
- 新增 `shotSlice.ts`：提供 `selectedShotId` 配套动作、镜头卡 CRUD/重排/选择、时长与过渡更新、手动捕获、模式切换及对象增删同步纯辅助函数。
- 简易模式用户编辑通过同一个 `set` 同时提交 `objects + shots + animation`；播放态不自动记录，scrub 仍走原有静默采样入口。
- `TrackedState` 加入 `shots/editorMode`；选卡应用完整对象快照并把播放头定位到对应卡起点。
- 新场景默认创建“片段 1”；加载工程选择首卡；项目保存/加载字段透传已由 1.1 完成，无需重复修改。
- 验证：`npm run test` 36/36、`npm run lint`、`npx tsc --noEmit`、Electron tsc 全通过。
- 遗留：真实 Electron 镜头卡交互须待 2.2 UI 接入后由用户手动验收。

## 2.2 镜头卡时间轴面板 —— 已完成（自动验证）

- 新增镜头卡面板、卡片和时间工具；支持增删选卡、拖拽重排、双击重命名、两类时长编辑、播放区间高亮和空状态。
- 复用 `useReorderDrag`、`Ui*` 与共用 `PlaybackButtons`；Dock 按模式切换，专业面板行为不变。
- 修复零差异镜头卡只有时长、无轨道时无法播放：简易模式以 shots+duration 判定，专业模式仍要求轨道。
- 39/39 测试、lint、前后端 tsc、颜色/原生控件/diff 检查通过；真实 Electron 鼠标交互待用户验收。

## 2.4 工程模式接入与专业功能收敛

- 状态：已完成，等待主控复核。
- 新建工程已支持简易/专业选择，默认简易；简易模式由现有 store 单向初始化“片段 1”。
- 顶栏已显示模式徽标；简易模式隐藏统一码表入口并继续复用 `ShotTimelinePanel`。
- “转为专业工程”仅保留禁用占位，未进入 3.2、未实现烘焙。
- 自动检查全部通过；真实 Electron 交互待用户手动验收。

## 3.1 摄像机效果器 —— 已完成

- 日期：2026-07-10
- 新增确定性纯函数采样器，支持 handheld 与 breathing，并覆盖确定性、零强度、频率变化单测。
- 实时播放、暂停/scrub 与逐帧导出统一在真实取景相机叠加；偏移不写 store、不产生关键帧。
- 摄像机属性面板提供两种效果器开关及强度/频率调节，复用现有 Ui primitives。
- 自动验证全部通过；真实 Electron 观感与导出一致性待用户手动验收。
