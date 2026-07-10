# 运镜控制简易模式 · 补充设计决策

## 2.3 过渡细节层面板

- **采用卡片条下方单抽屉**：每个非末卡仅提供展开入口，同时只展示一个过渡详情；避免遮挡卡片和复制卡片/播放条，默认收起保持新手界面简洁。
- **差异检测从编译器导出同源纯函数**：`diffShotObjects` 复用可动画属性注册表、快照合并与差异容差，保证 UI 列表与实际编译变化口径一致。
- **运镜类型切换写入推荐默认值**：直接复用 `STAGE_CAMERA_MOVE_DEFAULTS`，让新选择立即产生可见效果；非 direct 时始终展示终点几何权威提示。
- **角色“无动作”映射为 pose，“自动”映射为未设置 override**：沿用既有 `StageCharacterMotion`，不引入 UI 特定持久化数据。

## 2.2 镜头卡时间轴面板

- 从专业 `PlaybackControls` 抽出无参数 `PlaybackButtons`，两种面板共用停止、播放/暂停与循环逻辑。
- 导出编译器 `buildShotTimeline`，UI 工具只映射 shotId 和查找播放头卡，避免重复时间累加规则。
- 用 shotId 数组适配统一 `useReorderDrag`；全部控件继续使用 `Ui*`。
- 2.1 缺少重命名接口，补最小 `updateShotName`；名称不影响编译，不触发无意义重编译。
- **播放可用性按模式定义**：共享按钮接收可选 `canPlay`；专业模式默认沿用“存在轨道”，简易模式使用“存在卡且 duration>0”。store `play()` 同步采用相同规则，保证零属性差异但有停留时长的卡片也能推进播放头。

## 1.1 简易模式数据模型与工程持久化

- **`StageCameraEffector` 定义在 `shotTypes.ts` 而非 `sceneTypes.ts`**：按任务草案要求，`sceneTypes.ts` 用 `import type` 引用 `shotTypes.ts` 的类型，`shotTypes.ts` 也用 `import type` 引用 `sceneTypes.ts` 的类型。两个方向都是纯类型导入，`isolatedModules` 下会被完全擦除，不产生运行时循环依赖，`tsc`/`vite`/`esbuild` 均验证通过。
- **`captureShotObjectState` 的字段获取策略**：`transform.position/rotation/scale`、`color`、`fov` 通过 `animatableProps.ts` 的 `getAnimatableGroupByPath(...).getBaseValue()` 获取（复用现有取值逻辑，且 fov 的"仅摄像机有效"分支逻辑天然复用，不用再写一次类型判断）；`pose` 用已有的 `clonePose()` 深拷贝（避免多个镜头卡共享同一份关节对象引用）；`motion`、`lookAt` 无现成的取值/克隆工具，且本身是浅层不可变对象（项目里状态更新一贯走 spread 不做原地修改），直接引用赋值。
- **`normalizeShots` 的宽松解析深度**：对齐 `sceneSerialization.ts` 现有 `parseAnimation`/`objects` 字段的处理力度——只在顶层结构（数组、id/name/hold/transitionDuration 数值、`transition` 结构）做校验和默认值回退，`objectStates` 内部按类型转换直接信任（与现有 `deserializeScene` 对 `record.objects` 的处理方式一致，未额外加一层更重的深度校验），避免过度设计导致文件超出体积预期。
- **`normalizeEditorMode` 非法值回退为 `'pro'`**：`'simple'` 精确匹配才算简易模式，其余任何值（包括 `undefined`、损坏数据）一律回退专业模式——专业模式是当前唯一功能完整的模式，回退到它最保守、不会把用户带进一个还没造完 UI 的简易模式。
- **store 新增字段但不建 slice/action**：`CameraStageState` 新增 `editorMode`（默认 `'simple'`，对齐重要记录 007"新建工程默认简易"）与 `shots`（默认 `[]`），`newScene`/`loadSnapshot` 里同步重置/回填，但不加任何 setter action，也未接入 `temporal` 的 `partialize` 撤销追踪范围——这两块显式留给 2.1（store 分片与自动记录）决定该不该进撤销历史、要不要独立 slice。
- **effectors 迁移函数命名为 `withDefaultCameraEffectors`**：与既有 `withDefaultCameraAspectRatio`、`withNormalizedCharacterMotion` 命名风格对齐；但改成对所有版本无条件执行（不像 aspectRatio 只在 `version < 5` 时跑），因为它同时承担"给 v10 及以下补默认值"与"给任意版本的损坏/非法 effectors 做兜底"两个职责，风格对齐 `withNormalizedCharacterMotion` 的无条件调用方式。

## 1.2 快照差异编译器

- **测试基建选型**：项目原无 vitest/jest，按任务文件"优先引入 vitest"方案执行——新增 `vitest@^1.6.1` devDependency（未引入 `@vitest/ui`/`jsdom`/`happy-dom` 等额外包，domain 纯函数测试不需要浏览器环境）；`vitest.config.ts` 只配置 `test.include` 与 `resolve.alias`（对齐 `vite.config.ts` 的 `@/` → `src/`，因为 `sceneDefaults.ts` 等被测代码间接依赖 `@/core/theme/colorTokens`）。测试文件统一显式 `import { describe, expect, it } from 'vitest'`，不依赖全局注入，因此未改动 `tsconfig.json` 的 `types` 字段。
- **差异检测复用现有取值逻辑，而非重写一套"读快照字段"的代码**：`compileShotsToAnimation` 内部通过 `mergeStateIntoObject(object, state)` 把镜头卡快照的可动画字段（`transform`/`color`/`fov`/`lookAt`/`pose`/`motion`）覆盖进当前场景对象的一份浅拷贝上，再调用 `listAnimatableGroups(object)` + `descriptor.getValue(mergedObject)` 取值比较。这样差异检测天然与 `animatableProps.ts` 注册表的可用性规则（如摄像机没有 rotation/scale 轨道、角色才有 pose 关节轨道）保持一致，不需要在编译器里再写一份"哪个属性对哪种对象类型有效"的判断。
- **停留段守护点的时间选取**：守护点固定打在"下一段过渡的自然（未经错峰延迟平移）起点"，而不是"当前段过渡结束点本身"。原因：当前段的终点可能被本对象的错峰延迟平移提前，若仅用该点无法保证覆盖整个停留区间；用下一段过渡的自然起点作为停留区间的右边界，恰好与"若下一段过渡该属性也变化，其自身 segStart 点写在同一时间同一值"天然重合，去重规则替换后数值不变，不会产生冲突。
- **末段（最后一张卡对应的过渡）不加停留守护点**：因为 `sampleTrack` 对"末关键帧之后"的语义本身就是恒定末值，不需要额外补点；这样也避免给末卡再挂一个多余的无意义关键帧。
- **错峰延迟导致零长度过渡（起止钳制到同一时间点）时的产物形态**：`compileTransitionPoints` 依次写入 `[segStart, fromValue]`、`[segEnd, toValue]` 两个点，当 `segStart === segEnd`（极端延迟被双端钳制到同一边界）时，`upsertKeyframe` 的"同时间保留后写入"去重规则会让该轨道在该时间点只剩 1 个关键帧，值为 `toValue`——即该属性在此刻发生一次瞬时跳变，而不是保留两个同时刻不同值的点（关键帧模型本身不支持同一时间两个值）。测试用例按这个实际行为断言（`超界延迟被钳制到过渡区间边界，起止重合为单点跳变`），而不是断言两个坐标重合的关键帧。
- **摄像机运镜预设（1.3）扩展点位置**：放在 `compileTransitionPoints` 函数（`shotCompiler.ts`），而不是在外层 `compileObjectTransition`/`compileShotsToAnimation` 里做分支。函数签名保留 `object`/`move` 两个当前未使用的参数，专门留给 1.3 在函数内部判断 `object.type === 'camera' && move.kind !== 'direct'` 时改写返回的关键帧点数组；函数注释里给出了建议的独立编译函数签名（`compileCameraMovePreset`），并提示应只对 `transform.position` 分组的路径生效，`fov`/`color` 等其他属性仍走当前的直插逻辑，避免 1.3 接入时误伤不该受运镜预设影响的属性。
- **角色自动走跑（1.4）扩展点位置**：放在 `compileObjectTransition` 函数注释里，未创建具体的调用点或占位字段，因为 1.4 需要的"动作时间表"落点结构尚未定稿（见 handoff.md 重要记录 002），本任务不预先猜测数据结构，只在注释中标注 1.4 需要处理 `object.type === 'character'` 分支、需要参考 `motion`/`motionOverride` 字段、并链接到相关决策记录，交给 1.4 自行设计输出结构。
- **轨道 key 内部分隔符选用 `'::'`**：`TrackMap` 用 `${objectId}::${propertyPath}` 作为 `Map` 的 key（而非嵌套 `Map<string, Map<string, ...>>`），因为 `objectId`（uuid）与 `propertyPath`（点分路径）都不会包含 `::`，实现简单且避免了嵌套结构的读写复杂度；`finalizeTracks` 反解析时用 `TRACK_KEY_SEPARATOR` 常量的 `indexOf` + `length` 做切片，避免硬编码分隔符长度导致的偏移错误（联调时踩过一次此坑，见 test-report.md）。

## 1.3 摄像机运镜预设编译

- **一期 5 种预设全部实现，未省略 truck/crane**：任务文件"一期预设清单"表格列出的 direct/orbit/dollyIn/dollyOut/truck/crane 全部完成（`shotCameraMovePresets.ts`），未因时间/范围限制只做 orbit + dolly。`00-任务总览.md` 与本任务文件验收标准中的"5 种预设"勾选项按此更新为全部完成。
- **环绕（orbit）终点语义定稿（回填重要记录 003）**：选定倾向方案——选了非 direct 运镜预设后，本段过渡摄像机终点由编译时的几何计算决定，直接覆盖/忽略 B 卡快照里摆放的机位；不做"UI 选中运镜后自动把 B 卡机位吸附到落点"这类交互层同步方案（一期不做，避免简易模式再引入一层"卡片数据被静默改写"的心智负担，且几何覆盖已经保证渲染结果正确，UI 层是否同步显示落点是 2.3 的呈现问题，不影响编译正确性）。**该决策统一应用到全部 5 种非 direct 预设**（orbit/dollyIn/dollyOut/truck/crane），而不仅是 orbit——设计原则是"只要选了非 direct 运镜，几何计算即为唯一权威的位置来源"，保持全部预设行为一致，避免用户在细节层看到"预设参数和实际渲染结果对不上"的两套语义。选择原因：几何驱动是运镜预设存在的意义（环绕/横移这类效果本来就做不到"随便摆两个机位就能插值出正确弧线/平移"），如果终点还要看 B 卡机位则预设参数（degrees/offset/height 等）会变得没有意义或产生冲突歧义。
- **摄像机运镜位置分量的拦截点，从 handoff.md 建议的位置做了调整**：handoff.md 给 1.3 的建议是在 `compileTransitionPoints` 函数内部按 `object.type === 'camera' && move.kind !== 'direct'` 分支处理（该函数当时逐分量 scalar 调用一次）。实际实现时发现这个方案行不通：orbit 的绕轴旋转、truck 的垂直视线方向平移都需要 X/Y/Z 三分量的整体向量信息（如旋转矩阵作用于完整向量），而 `compileTransitionPoints` 每次只拿到单个分量的 scalar `fromValue`/`toValue`，无法独立算出正确结果（除非把完整的 fromPosition/toPosition/targetPosition 都塞进这个本该轻量的两点直插函数签名，导致函数职责混乱）。因此改为在 `compileObjectTransition` 的分组循环入口拦截（新增 `isCameraPositionMoveGroup` 判断 `group.groupPath === 'transform.position'`），命中时调用新增的 `compileCameraPositionGroup` 一次性算出三分量采样点、写入 x/y/z 三条轨道，然后 `continue` 跳过该分组的逐分量循环。`compileTransitionPoints` 仍按 handoff 建议加了 `propertyPath` 参数，但把它的用途从"分支处理"改成"防御性断言"：一旦摄像机运镜位置分量意外流入该函数（说明分组拦截条件 `isCameraPositionMoveGroup` 与此处的 `isCameraPositionAxisPath` 判断不一致，编译器内部不变量被破坏），直接 `throw`，避免静默退化为错误的两点直插掩盖 bug。fov/color 等非位置属性的编译路径完全不受影响。
- **环绕采样：角度均匀 + 时间缓动反解，而不是时间均匀 + 角度缓动**：任务文件要求"环绕每 ~15° 一个中间关键帧"（保证圆弧近似质量与运动速度无关）+ "整体速度感通过对采样时间做缓动重映射"。若改成时间均匀采样、角度按缓动曲线分布，则 easeInOut 场景下运动最快的中段会恰好角度步长最大（采样最稀疏），圆弧近似误差在最需要精度的地方最大，不符合任务意图。因此实现为：先按角度均匀取 `stepCount = round(|degrees| / 15)` 个步进点（`s = i / stepCount`），再用二分法数值反解缓动曲线（`invertEasing`，对 `easeProgress` 做单调反函数近似）求出每个点对应的归一化时间 `u`，使得 `easeProgress(easing, u) ≈ s`，最终 `time = segStart + (segEnd - segStart) * u`。这样圆弧几何精度只取决于角度步长（与缓动无关，稳定可靠），速度感完全体现在采样点的时间分布上。
- **orbit 采样点之间统一用 `linear` 分段，不再叠加原始 easing**：如果给 orbit 数组的每个点都设置 `easing = 传入的 easing`（如 easeInOut），会与"时间已经按该 easing 反解重映射过"的效果叠加，产生双重非线性、结果不可预期。因此 orbit 全部采样点的 `easing` 字段固定为 `'linear'`——非均匀的时间分布已经承载了整体速度感，逐段用 linear 插值即是"多段折线近似一条已经变速采样的圆弧"，符合任务文件"linear 分段近似圆弧"的表述。dolly/truck/crane 这类只有首尾两点的预设则维持原有做法：起点 `easing` = 传入的速度预设映射结果，终点 `easing = 'linear'`（末关键帧 easing 本身无意义，对齐 `StageKeyframe` 注释约定）。
- **环绕/运镜目标点解析新增 `resolveShotLookAtTarget`（shotCompiler.ts），不复用 `cameraUtils.ts` 的 `resolveCameraLookAtTarget`**：后者的入参是"当前场景实时对象数组"，返回的是目标对象**当前**位置；而 1.3 需要的是"过渡起始卡（fromShot）快照中的目标位置"（对齐任务文件"当前情况"给出的一期简化约定：目标自身在本段过渡中的移动不追踪，取过渡起始卡的目标位置）。两者数据源不同，无法直接复用，因此新写了一个从 `StageShot.objectStates` 取值的版本；但朝向偏移算法本身（`manual` 直接用 target；`object` 模式若目标是角色则取 `position.y + 1 * scale.y` 的胸口高度）完全对齐 `cameraUtils.ts` 的 `getObjectLookAtPoint`，只是数据来源换成快照，避免出现两套不一致的"目标点怎么算"逻辑。
- **向量数学工具保留在 `shotCameraMovePresets.ts` 内部，未扩展/复用 `cameraUtils.ts`**：`cameraUtils.ts` 现有内容全部是"lookAt 目标解析"相关（`getObjectLookAtPoint`/`resolveCameraLookAtTarget`/`getCameraObjects`），关注点是"给定对象和 lookAt 配置，算出应该看向哪里"；而运镜预设需要的是"给定位置向量做加减/缩放/绕轴旋转"这类通用几何运算，两者关注点不同。加上 `shotCameraMovePresets.ts` 全部实现只有 207 行、体积充裕，向量工具函数（`addVec3`/`subVec3`/`scaleVec3`/`rotateAroundY`）保持 file-private 更符合"就近声明、不过度抽象"的原则，未来如果其他模块也需要这些通用向量运算，再考虑上提为共享工具。
- **摄像机朝向机制验证结论（未过时）**：执行时重新读取 `src/features/cameraStage/scene/StageViewportCamera.tsx` 确认——真实渲染相机的朝向由 `camera.lookAt(lookAtTarget.x, lookAtTarget.y, lookAtTarget.z)` 在位置采样回调（`registerPlaybackApplier(cameraObject.id, 'transform.position', ...)`）与初始 `useLayoutEffect` 中每次都重新计算，不读取任何 `transform.rotation` 关键帧轨道；`animatableProps.ts` 的 `TRANSFORM_GROUPS` 对 `rotation`/`scale` 两个分组用 `notCamera` 过滤，摄像机对象在可动画属性注册表里本来就没有这两个分组。验证方式：`Grep` 定位到 `StageViewportCamera.tsx` 后通读全文件（71 行），逐行确认 `camera.position.set` 与 `camera.lookAt` 的调用时机和数据来源。结论与 handoff.md/任务文件给出的预判完全一致、未过时，因此本任务的运镜预设编译**只生成位置关键帧**，不涉及旋转轨道，不需要为"摄像机朝向"额外做任何编译或渲染层改动。

## 1.4 角色自动走跑与朝向推断

- **动作时间表采用方案 A 并归属 `StageSceneAnimation`**：它是镜头卡编译产物，不是 shots 权威源，也不是专业关键帧轨道；与 animation 一起进入 store/序列化可确保播放、scrub、导出读取同一份确定性数据，同时避免扩展 keyframeEngine/专业时间轴的值类型。
- **时间表项显式携带 `afterMotion`**：仅记录过渡期间 motion 不足以表达“到达后恢复 B 卡动作”，而当前 store 对象的 motion 不保证等于任意镜头卡快照。解析器在区间结束后沿用 `afterMotion`，直到下一条时间表覆盖。
- **速度按水平位移计算**：走跑与面朝方向忽略 Y 轴高度变化，避免角色乘电梯/跳高时误触发跑步。阈值定稿为 `<0.1m/s` 不触发、`0.1～<1.8` Walk、`1.8～<4` Jog、`>=4` Sprint，一期播放速度固定 1。
- **朝向覆盖通用 rotation.y 两点轨道**：有效位移时生成 0% 原朝向、15% 移动朝向、85% 移动朝向、100% B 卡朝向四点；用角度展开保证相邻点最短旋转。其他旋转分量与无位移场景仍走通用差异编译。
- **`motionOverride` 不强制无位移角色播放动作**：覆盖项只替换已经触发移动推断的动作选择；低于阈值仍不生成 schedule，避免“角色未移动但因过渡详情残留而原地跑步”。

## 2.1 简易模式 store 分片与自动记录

- **不新增独立 motionSchedule store 字段**：每次 shots 变化直接保存 `compileShotsToAnimation` 返回的完整 `StageSceneAnimation`，确保 `motionSchedule` 与轨道、duration、fps 同生同灭且不会被截断。
- **自动记录采用 action 显式分叉**：仅 `updateObject/updateTransform/updatePoseJoint/applyPosePreset` 在 `editorMode==='simple' && !playback.playing` 时写回选中卡；不订阅 objects，因此播放采样和 scrub 静默落值不会污染卡片。
- **对象结构变化同步全部卡片**：新增/复制对象以创建当下状态补入每张卡；删除对象同时清理 `objectStates/perObject/cameraMoves`，再基于清理后的 shots 重编译。
- **selectedShotId 是界面态，不进撤销跟踪/持久化**：shots 与 editorMode 进入 zundo；选中项加载时回到首卡，删除选中卡时选择相邻卡。

## 2.4 工程模式接入与专业功能收敛

- **模式在创建服务入口落定**：`createNewProject` 接收默认值为 `simple` 的 `StageEditorMode`，先 `newScene` 再调用既有 `setEditorMode`；后者已负责简易模式首卡创建与编译，避免复制 `createShot`/编译逻辑。
- **码表在统一组件内收敛**：所有属性面板都经 `KeyframeStopwatch` 渲染码表，因此组件内按 `editorMode` 返回 null，专业模式逻辑完全复用原实现。
- **不提前实现烘焙**：顶栏简易模式仅展示禁用的“转为专业工程”，模式仍由工程创建或旧工程迁移确定；单向烘焙留给 3.2。
- **工程列表不展示模式徽标**：遵循重要记录 005，不扩展 summary/DB；模式徽标仅在编辑器顶栏显示。
- **复用现有 UI primitive**：模式选择使用 `UiModal`、`UiOptionButton`，未新增通用组件或原生控件。

## 3.1 摄像机效果器

- **叠加真实取景相机而非 store 对象**：渲染偏移不写回 `objects.transform`，避免保存污染、自动记录污染及密集关键帧。
- **播放 applier 显式携带采样时间**：效果器使用每帧准确时间，不依赖约 20fps 节流回写的 UI 播放头；启用效果器时，即使摄像机无位置轨道也下发基础位置。
- **暂停/scrub/导出复用同一纯函数**：非播放状态由 `StageViewportCamera` 使用 store `currentTime` 重算；导出逐帧 `seek` 自动继承。
- **局部坐标叠加顺序**：先基础位置与 `lookAt`，再局部平移和局部欧拉旋转。handheld 同时影响机位与朝向，breathing 沿局部 Z 轴推拉。
- **效果器参数不打关键帧**：一期作为摄像机持久化配置直接编辑，简易与专业模式共用。

## 3.2 单向烘焙为专业工程

- **store 原子转换、服务编排副作用**：`bakeToProMode` 只完成最新编译与状态翻转；工程服务负责清历史、保存和日志，避免 store slice 反向依赖项目持久化层。
- **motionSchedule 随 animation 原样固化**：角色自动走跑时间表是已编译动画的组成部分，转换后保留为确定性播放数据，不再由 shots 派生。
- **effectors 不参与烘焙**：摄像机效果器是对象持久化配置且本就兼容专业模式，转换不改 objects，因此配置和渲染效果自然保留。
- **保存失败不回滚**：工程已经进入专业模式且历史已清空；失败时保留一致的专业内存态，提示用户重试保存，避免恢复成半简易状态。
- **入口与 action 双重锁定**：专业模式不渲染转换入口，`setEditorMode('simple')` 也拒绝从专业回退，保证不可逆约束不依赖 UI。
