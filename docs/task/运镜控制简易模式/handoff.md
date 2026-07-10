# 运镜控制简易模式 · 任务交接

## 2.3 完成交接（交给 2.4）

- `ShotTimelinePanel.tsx` 已叠加默认收起的过渡详情抽屉；2.4 做模式接入时只需保留简易模式入口，不要复制该面板。
- 详情层统一通过 store `updateShotTransition` 写回并即时编译，撤销由现有 zundo tracked shots 承担。
- `shotCompiler.ts` 已导出 `diffShotObjects(fromShot, toShot, objects)`；后续需要展示变化对象时必须复用，不另写 diff。
- 摄像机与角色细节基于对象类型而非 modelId；全部使用现有 Ui*。
- 自动静态验证全通过；真实 Electron 展开、播放节奏、预设效果和撤销需用户按 `test-report.md` 验收。

## 2.2 完成交接（交给 2.3）

- 简易面板入口 `simple/ShotTimelinePanel.tsx`、卡片 `ShotCard.tsx`；2.3 在其上叠加细节入口，不复制卡片或播放条。
- 当前卡区间走 `shotTimelineUtils.getShotAtTime`，底层复用 `buildShotTimeline`，后续不要另写时间累加。
- store 新增 `updateShotName`；时长/过渡详情继续走 `updateShotTiming` / `updateShotTransition`。
- 零轨道简易片段可正常启动播放；专业模式零轨道仍禁用。自动验证 39/39 及全部静态检查通过；真实 Electron 点击、拖拽和播放待用户验收。

## 2.1 完成交接（交给 2.2）

- `CameraStageState` 已提供 `selectedShotId` 及 `addShot/removeShot/reorderShot/selectShot/updateShotTiming/updateShotTransition/captureIntoSelectedShot/setEditorMode`。
- `selectShot(id)` 会应用该卡完整对象快照并把播放头定位到卡起点；2.2 面板无需自行计算或写 objects。
- 所有 shots 变更均同步重编译完整 `animation`，其中 `motionSchedule` 已保留；UI 禁止另行拼接 animation。
- 自动记录已接在用户编辑 action，播放与 scrub 不写卡；2.2 只需调用 store action。
- `selectedShotId` 是非持久化界面态，加载时默认首卡；镜头卡顺序本身由 shots 数组表达。
- 全量自动验证 36/36，lint 与前后端 tsc 通过。真实 Electron 交互按 `test-report.md` 由用户在 2.2 完成后验收。

## 1.4 完成交接（交给 2.1 / 2.3 / 3.2）

- `compileShotsToAnimation` 返回类型仍是 `StageSceneAnimation`，但该类型现含必需字段 `motionSchedule`；空编译与默认动画均返回空数组，旧持久化数据由 `parseAnimation` 补空数组。
- 时间表项为 `{ objectId, startTime, endTime, motion, afterMotion }`。`CharacterModel` 已通过 `resolveCharacterMotionAtTime` 消费，过渡内从区间起点 seek 临时 clip，结束后恢复目标卡动作。
- 2.1 每次 shots 变化重编译并写入完整 animation 即可，不需另建 schedule store 字段；不要丢弃 `motionSchedule`。
- 2.3 的 `motionOverride` 已贯通编译器；它只覆盖达到移动阈值后的自动分级，无位移/低速不会原地播放覆盖动作。
- 3.2 烘焙为专业工程时必须保留 `animation.motionSchedule`；若未来引入专业离散动作轨道，再做显式转换，当前不要清空。
- 朝向轨道路径是 `transform.rotation.y`，有效位移时为四点（0/15/85/100%）；Y 轴位移不参与走跑速度和朝向计算。
- 真实视口手动验收尚未执行，需等 2.2 镜头卡 UI 可操作后按 `test-report.md` 步骤交给用户验证。

## 交给 1.3（摄像机运镜预设编译）与 1.4（角色自动走跑与朝向推断）需要知道的接口

两者都在 `src/features/cameraStage/domain/shotCompiler.ts` 基础上扩展，互相独立、可并行；不需要改动 `compileShotsToAnimation` 的外层结构（时间轴布点、错峰延迟、停留段守护点、去重）。

- **编译器主入口**：`compileShotsToAnimation(shots: StageShot[], objects: StageObject[]): StageSceneAnimation`，纯函数。1.3 完成后当前共 25 个单元测试全部通过（`shotCompiler.test.ts` 15 个 + `shotCameraMovePresets.test.ts` 10 个），可直接作为 1.4 修改前后的回归基线（跑 `npm run test`）。
- **测试基建已就绪**：`npm run test`（vitest run）。新增用例直接加进 `shotCompiler.test.ts`，或视体积另开 `shotCompilerXxx.test.ts`；`vitest.config.ts` 已配置 `@/` alias，无需再改配置。
- **1.4 需要注意**：`compileObjectTransition` 函数签名末尾新增了一个可选参数 `cameraLookAtTarget?: StageVec3`（1.3 引入，见下方"1.3 摄像机运镜预设编译扩展点"里的说明），1.4 若要扩展该函数请追加在参数列表末尾，不要调整已有参数顺序。

### 1.3 摄像机运镜预设编译扩展点（已完成，供 1.4/2.3 参考）

- **实现位置与最终签名（与本文件之前给的建议不同，见下方"与建议的差异"）**：
  - 几何纯函数：新文件 `src/features/cameraStage/domain/shotCameraMovePresets.ts`，统一入口 `compileCameraMoveSamples(move, fromPosition, targetPosition, segStart, segEnd, easing): CameraMoveKeyframePoint[]`（`CameraMoveKeyframePoint = { time, position: StageVec3, easing }`）。
  - 编译器接入：`shotCompiler.ts` 新增 `compileCameraPositionGroup(trackMap, cameraId, fromPosition, move, targetPosition, segStart, segEnd, easing, holdGuard)`，在 `compileObjectTransition` 的分组循环入口拦截 `object.type === 'camera' && group.groupPath === 'transform.position' && move.kind !== 'direct'`（判断函数 `isCameraPositionMoveGroup`），一次性算出 x/y/z 三分量采样点并写入三条轨道，然后 `continue` 跳过该分组原本的逐分量循环。
- **与本文件之前给 1.3 的建议的差异（重要，避免后续任务按旧建议去找代码）**：原建议是在 `compileTransitionPoints`（逐分量 scalar 调用）内部按 `move.kind` 分支。实际发现走不通——orbit 的绕轴旋转、truck 的垂直视线平移都需要 X/Y/Z 三分量整体向量，单分量签名算不出正确结果。因此实际拦截点上移到 `compileObjectTransition` 的分组循环入口（见上）。`compileTransitionPoints` 确实按建议加了 `propertyPath: string` 参数，但它现在的作用是**防御性断言**（一旦摄像机运镜位置分量意外流入该函数就直接 `throw`），不再是分支入口。完整理由见 `decisions.md` 的"1.3 摄像机运镜预设编译"小节。
- **`compileObjectTransition` 函数签名变化（1.4 需要知道）**：末尾新增了一个**可选**参数 `cameraLookAtTarget?: StageVec3`，只在 `compileShotsToAnimation` 主循环里"摄像机 + 非 direct 运镜"的场景下才会被传值（其余场景传 `undefined`，函数内部有 `?? fromState.transform.position` 兜底，不会因为 `undefined` 崩溃）。这是一个**追加在末尾的可选参数**，不影响已有调用方式；1.4 如果要给 `compileObjectTransition` 也加一个"动作时间表"相关的输出参数（如累加结构），建议同样以"追加在参数列表末尾的可选参数/可变引用"的形式加，不要调整现有参数顺序，避免互相冲突。函数内部的分组循环里，摄像机 `transform.position` 分组已被 1.3 拦截并 `continue`，但 `object.type === 'character'` 的分支（1.4 的场景）完全不受影响——`isCameraPositionMoveGroup` 第一个条件就是 `object.type === 'camera'`，角色对象永远不会命中这个分支，1.4 可以放心在同一个函数体内（分组循环之外，或角色专属逻辑处）添加自己的钩子。
- `StageCameraMove` 判别联合已在 `shotTypes.ts` 定稿为 5 种：`direct`（无参数）、`orbit: { degrees: number; direction: 'cw'|'ccw' }`、`dollyIn`/`dollyOut: { distanceRatio: number }`、`truck: { offset: number }`、`crane: { height: number }`，一期预设清单全部实现，未省略任何一种。
- 摄像机对象上只有 `transform.position` 可动画（`transform.rotation`/`scale` 对摄像机不可动画，见 `animatableProps.ts` 的 `TRANSFORM_GROUPS`），朝向由 `lookAt` 字段驱动，执行时重新验证过（见 `decisions.md`），结论未过时：不涉及旋转轨道。
- 环绕（orbit）等预设的目标点解析：新增 `resolveShotLookAtTarget(cameraState, fromShot, objects)`（`shotCompiler.ts`），取过渡起始卡快照中的 lookAt 解析结果，一期不追踪目标自身在本段过渡中的移动。

### 交给 2.3（过渡细节层 UI）需要暴露的运镜预设参数

- 摄像机过渡的细节层需要提供一个"运镜预设"选择器（`StageCameraMove.kind`：direct/orbit/dollyIn/dollyOut/truck/crane），选中不同 kind 后展示对应参数输入：
  - `orbit`：`degrees`（建议输入框或 ±90/180/270/360 快捷值，任务文件给的参考档位）+ `direction`（`cw`/`ccw` 二选一）。
  - `dollyIn`/`dollyOut`：`distanceRatio`（数值输入，建议 UI 提示"0.5 = 推到一半距离"这类语义说明；`STAGE_CAMERA_MOVE_DEFAULTS`（`shotCameraMovePresets.ts`）里有推荐默认值 `dollyInRatio: 0.5`/`dollyOutRatio: 1.8` 可直接复用）。
  - `truck`：`offset`（数值输入，默认参考 `STAGE_CAMERA_MOVE_DEFAULTS.truckOffset = 2`）。
  - `crane`：`height`（数值输入，默认参考 `STAGE_CAMERA_MOVE_DEFAULTS.craneHeight = 2`）。
- **重要交互提示（对齐重要记录 003 定稿）**：选中非 direct 运镜预设后，本段过渡摄像机的终点由几何计算决定，会覆盖/忽略用户在 B 卡上手动摆放的机位。2.3 设计交互时建议在 UI 上明确提示这一点（如"启用运镜预设后，终点机位将按预设参数自动计算，与该卡摆放位置无关"），避免用户误以为需要去 B 卡精确摆放机位。
- 运镜预设只对摄像机对象生效（`StageShotTransition.cameraMoves` 本身就是 `Record<cameraObjectId, StageCameraMove>`），2.3 的选择器应该只出现在摄像机对象的过渡细节面板上。

### 1.4 角色自动走跑与朝向推断扩展点

- 位置：`shotCompiler.ts` 的 `compileObjectTransition` 函数（约第 163 行），函数头部已有 TODO(1.4) 注释块。
- 现状：该函数目前只做逐属性差异直插，**完全没有处理"走/跑"动作**——`StageShotObjectState.motion`（卡内动作快照）和 `StageShotTransitionObjectDetail.motionOverride`（覆盖自动推断结果）这两个字段已经存在于 1.1 的类型定义里，但编译器还没读取/写入任何跟它们相关的输出。
- **关键未决问题（重要记录 002，需要 1.4 自己定稿）**：动作切换的"时间表"应该放在哪里？现有 `StageSceneAnimation` 只有 `tracks: StageTrack[]`（逐属性关键帧）+ `duration` + `fps`，没有"某时间段播放哪个动作片段"的字段。1.4 需要二选一（或提出第三种方案）：
  1. 扩展 `StageSceneAnimation`（在 `animationTypes.ts` 里新增字段，如 `motionSchedule: Array<{objectId, motion, startTime, endTime}>`），播放/导出链路（`StagePlaybackDriver`、`cameraStageVideo`）要能感知这个新字段并在采样时切换角色动作；
  2. 或者完全不进 `StageSceneAnimation`，走一条独立于关键帧轨道的旁路结构，由播放层单独消费。
  这个决策会影响播放/导出链路是否需要改动（当前 1.2 的定位是"零改动或极小改动"），1.4 落地前建议先确认这一点，必要时更新 00-任务总览.md 里"核心技术路线"的表述。
- 若 1.4 决定方案 1（扩展 `StageSceneAnimation`），改动点在 `animationTypes.ts`（加字段）和 `shotCompiler.ts` 的 `compileObjectTransition`（在 `object.type === 'character'` 分支里，根据 `fromState`/`toState` 的位置差算走跑速度，结合 `motionOverride` 覆盖优先级，生成时间表条目并写回一个新的累加结构，函数需要相应加一个可变的输出参数或改造成返回值）。
- 角色的位置/朝向轨道（`transform.position`、`transform.rotation`）已经由通用差异检测覆盖（角色不是摄像机，`notCamera` 为 true，rotation/scale 可用），1.4 不需要重新实现这部分；只需要额外决定"动作片段"怎么表达和消费。

## 交给 1.2（快照差异编译器）需要知道的接口（已完成，供历史参考）

- 类型全部在 `src/features/cameraStage/domain/shotTypes.ts`：
  - `StageShot { id, name, hold, transitionDuration, objectStates: Record<objectId, StageShotObjectState>, transition: StageShotTransition }`
  - `StageShotObjectState { transform, color, fov?, lookAt?, pose?, motion? }`——`fov`/`lookAt` 只在对象是摄像机时会被赋值，`pose`/`motion` 只在对象是角色时会被赋值，编译器按 `object.type` 分支读取即可，不需要再判空猜测。
  - `StageShotTransition { perObject: Record<objectId, StageShotTransitionObjectDetail>, cameraMoves: Record<objectId, StageCameraMove> }`——**编译时容错**：`perObject`/`cameraMoves` 里没有某个 objectId 的 key 是合法状态（表示该对象这段过渡走默认速度预设/无运镜预设），编译器要对缺失 key 有默认行为，不要假设所有对象都有条目。
  - `StageCameraMove` 目前只有骨架（`direct`/`orbit`/`dollyOut`/`dollyIn`），参数细化在 1.3，编译器对话本任务交付的骨架先接 `direct`（两态直插）即可，其余 kind 先占位。
  - `createShot(objects, name)`：新建一张卡，`hold`/`transitionDuration` 默认 0.5s/2s（常量 `STAGE_SHOT_DEFAULT_HOLD`/`STAGE_SHOT_DEFAULT_TRANSITION_DURATION`），`transition` 为空（`{ perObject: {}, cameraMoves: {} }`）。
  - `captureShotObjectState(object)`：单对象状态捕获，"选中卡片时场景改动自动记录"（2.1）与手动"新建镜头卡"都应复用它，不要重新手写捕获逻辑。
- **motion 的时间表机制仍未定稿**（重要记录 002，待 1.4 定稿）：`StageShotObjectState.motion` 只是卡内静态动作快照，过渡期间"临时播放走/跑动画"的旁路时间表（`motionSchedule` 之类）不在 1.1 范围内，1.2/1.4 设计编译器输出结构时需要单独决定放哪、怎么存。
- **编译目标**：现有 `StageTrack`/`StageKeyframe`（`animationTypes.ts`）、`StageSceneAnimation`。编译器输入是 `StageShot[]`，输出应是可直接赋给 `CameraStageState.animation` 的 `StageSceneAnimation`，采样/播放/导出引擎不用改。
- **差异检测**：1.2 需要自己实现"前后两卡属性是否变化"的判断（带容差），`animatableProps.ts` 的 `listAnimatableGroups`/`getAnimatablePropByPath` 是现成的属性分组/取值查表工具，可直接复用于对比 `objectStates` 里每个属性的前后值。

## store 现状（供 2.1 参考，本任务未建 slice/action）

- `CameraStageState` 新增了 `editorMode: StageEditorMode`（默认 `'simple'`）与 `shots: StageShot[]`（默认 `[]`），`newScene`/`loadSnapshot` 会重置/回填这两个字段，但**没有任何 setter action**，也**没有**加入 `temporal` 的 `partialize` 撤销追踪范围（当前 `partialize` 仍只追踪 `{ objects, animation }`）。
- 2.1 要决定：`shots` 的增删改要不要进撤销历史（大概率要，"自动记录"依赖撤销兜底，参考重要记录 007）、是否拆成独立 slice 文件（当前 `cameraStageStore.ts` 已 778 行，继续在主文件里堆 action 会加剧体积问题，建议参考已有 `keyframeSlice.ts` 的拆分方式新开一个 `shotSlice.ts`）。

## 工程锁定与烘焙相关注意（供 2.4/3.2 参考）

- v10 及以下旧工程加载后 `editorMode` 固定为 `'pro'`（不会被误判成简易），符合重要记录 007"已有旧工程一律视为专业工程"的约定。
- 新建工程（`newScene`）默认 `editorMode: 'simple'`，如果 2.4 做"新建工程选模式"的入口，需要让该入口能覆盖这个默认值（目前 `newScene(name)` 签名不接受 mode 参数，2.4 接线时可能要扩展签名或在调用方 set 之后立即覆盖）。
## 2.4 完成交接（交给 3.2）

- `simple/EditorModeBadge.tsx` 已接入顶栏；简易模式的“转为专业工程”当前是禁用占位，3.2 只在此接入单向烘焙，不要增加反向切换。
- `createNewProject(name, mode='simple')` 已锁定新工程模式；简易首卡由 `setEditorMode('simple')` 的现有逻辑创建，勿复制 `createShot`。
- `KeyframeStopwatch` 已在简易模式统一返回 null，专业模式及旧工程仍保留码表。
- 简易时间轴继续复用 `ShotTimelinePanel`，本阶段没有复制或改写 2.2/2.3 UI。
- 40/40 单测及静态检查通过；真实 Electron 的模式选择、重开持久化和顶栏展示待用户按 `test-report.md` 验收。
