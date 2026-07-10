# 运镜控制简易模式 · 任务交接

## 交给 1.3（摄像机运镜预设编译）与 1.4（角色自动走跑与朝向推断）需要知道的接口

两者都在 `src/features/cameraStage/domain/shotCompiler.ts` 基础上扩展，互相独立、可并行；不需要改动 `compileShotsToAnimation` 的外层结构（时间轴布点、错峰延迟、停留段守护点、去重）。

- **编译器主入口**：`compileShotsToAnimation(shots: StageShot[], objects: StageObject[]): StageSceneAnimation`，纯函数，已跑通 13 个单元测试（`shotCompiler.test.ts`），可直接作为 1.3/1.4 修改前后的回归基线（跑 `npm run test`）。
- **测试基建已就绪**：`npm run test`（vitest run）。新增用例直接加进 `shotCompiler.test.ts`，或视体积另开 `shotCompilerXxx.test.ts`；`vitest.config.ts` 已配置 `@/` alias，无需再改配置。

### 1.3 摄像机运镜预设编译扩展点

- 位置：`shotCompiler.ts` 的 `compileTransitionPoints` 函数（约第 122 行），函数头部已有 TODO(1.3) 注释块。
- 现状：函数签名 `compileTransitionPoints(object: StageObject, move: StageCameraMove | undefined, fromValue, toValue, segStart, segEnd, easing): StageKeyframe[]`，`object`/`move` 两个参数当前**故意未使用**（预留），函数体目前不区分 `move.kind`，一律返回 `[{time:segStart,value:fromValue,easing},{time:segEnd,value:toValue,easing:'linear'}]`（direct 两点直插）。
- 需要做的事：在函数内部加分支——当 `object.type === 'camera' && move !== undefined && move.kind !== 'direct'` 时，改为调用新的运镜预设编译函数（建议命名 `compileCameraMovePreset`，建议放新文件 `shotCameraMovePresets.ts`，避免 `shotCompiler.ts` 继续膨胀），返回多点关键帧数组来近似 orbit/dollyIn/dollyOut 的运镜轨迹。
- 建议签名（供参考，1.3 可按需调整）：
  ```ts
  function compileCameraMovePreset(
    move: Exclude<StageCameraMove, { kind: 'direct' }>,
    fromValue: StageKeyframeValue,
    toValue: StageKeyframeValue,
    segStart: number,
    segEnd: number,
    easing: StageEasingPreset,
  ): StageKeyframe[]
  ```
- **重要范围提示**：这个分支只应该拦截 `transform.position` 分组的路径（`transform.position.x/y/z`）。`compileObjectTransition` 对同一个摄像机对象会为 `fov`、`color` 等其它变化属性也调用 `compileTransitionPoints`，这些属性应该继续走直插逻辑，不要被运镜预设分支误伤。当前 `compileTransitionPoints` 函数签名里没有 `descriptor`/`propertyPath` 参数，1.3 接入时大概率需要给函数加一个 `propertyPath: string` 参数（`compileObjectTransition` 调用处已经有 `descriptor.path` 可传）来做这个判断。
- 摄像机对象上只有 `transform.position`（`transform.rotation`/`scale` 对摄像机不可动画，见 `animatableProps.ts` 的 `TRANSFORM_GROUPS`），所以运镜预设只需要考虑位置轨道；朝向由 `lookAt` 字段驱动（不是关键帧轨道，渲染时实时计算，不在本编译器职责内）。
- `StageCameraMove` 目前只有骨架（`{kind:'orbit',degrees,direction}`、`{kind:'dollyIn'|'dollyOut'}`），参数是否够用由 1.3 自行判断，需要更多参数（如环绕中心、dolly 距离）可以扩展 `shotTypes.ts` 的类型定义。

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
