# 运镜控制简易模式 · 任务交接

## 交给 1.2（快照差异编译器）需要知道的接口

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
