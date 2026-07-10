# 运镜控制简易模式 · 补充设计决策

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
