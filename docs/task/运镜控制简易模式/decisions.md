# 运镜控制简易模式 · 补充设计决策

## 1.1 简易模式数据模型与工程持久化

- **`StageCameraEffector` 定义在 `shotTypes.ts` 而非 `sceneTypes.ts`**：按任务草案要求，`sceneTypes.ts` 用 `import type` 引用 `shotTypes.ts` 的类型，`shotTypes.ts` 也用 `import type` 引用 `sceneTypes.ts` 的类型。两个方向都是纯类型导入，`isolatedModules` 下会被完全擦除，不产生运行时循环依赖，`tsc`/`vite`/`esbuild` 均验证通过。
- **`captureShotObjectState` 的字段获取策略**：`transform.position/rotation/scale`、`color`、`fov` 通过 `animatableProps.ts` 的 `getAnimatableGroupByPath(...).getBaseValue()` 获取（复用现有取值逻辑，且 fov 的"仅摄像机有效"分支逻辑天然复用，不用再写一次类型判断）；`pose` 用已有的 `clonePose()` 深拷贝（避免多个镜头卡共享同一份关节对象引用）；`motion`、`lookAt` 无现成的取值/克隆工具，且本身是浅层不可变对象（项目里状态更新一贯走 spread 不做原地修改），直接引用赋值。
- **`normalizeShots` 的宽松解析深度**：对齐 `sceneSerialization.ts` 现有 `parseAnimation`/`objects` 字段的处理力度——只在顶层结构（数组、id/name/hold/transitionDuration 数值、`transition` 结构）做校验和默认值回退，`objectStates` 内部按类型转换直接信任（与现有 `deserializeScene` 对 `record.objects` 的处理方式一致，未额外加一层更重的深度校验），避免过度设计导致文件超出体积预期。
- **`normalizeEditorMode` 非法值回退为 `'pro'`**：`'simple'` 精确匹配才算简易模式，其余任何值（包括 `undefined`、损坏数据）一律回退专业模式——专业模式是当前唯一功能完整的模式，回退到它最保守、不会把用户带进一个还没造完 UI 的简易模式。
- **store 新增字段但不建 slice/action**：`CameraStageState` 新增 `editorMode`（默认 `'simple'`，对齐重要记录 007"新建工程默认简易"）与 `shots`（默认 `[]`），`newScene`/`loadSnapshot` 里同步重置/回填，但不加任何 setter action，也未接入 `temporal` 的 `partialize` 撤销追踪范围——这两块显式留给 2.1（store 分片与自动记录）决定该不该进撤销历史、要不要独立 slice。
- **effectors 迁移函数命名为 `withDefaultCameraEffectors`**：与既有 `withDefaultCameraAspectRatio`、`withNormalizedCharacterMotion` 命名风格对齐；但改成对所有版本无条件执行（不像 aspectRatio 只在 `version < 5` 时跑），因为它同时承担"给 v10 及以下补默认值"与"给任意版本的损坏/非法 effectors 做兜底"两个职责，风格对齐 `withNormalizedCharacterMotion` 的无条件调用方式。
