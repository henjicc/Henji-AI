# 运镜控制简易模式 · 测试报告

## 1.1 简易模式数据模型与工程持久化

### 静态检查

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过，无输出 |
| `npx tsc -p tsconfig.json`（前端类型） | 通过，无输出 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无输出 |

### 迁移与往返序列化验证

项目当前没有 vitest/ts-node 等测试基建，未新增测试框架依赖。改用临时脚本验证：用 `esbuild`（已是 vite 依赖，`node_modules/.bin/esbuild`）把
`src/features/cameraStage/domain/__tmp_verify_v11__.ts` 打包为单文件 CJS，`node` 直接执行，验证完成后已删除该临时源文件与打包产物。

验证用例（共 21 项断言，全部通过）：

1. **v10 → v11 迁移**：构造一份 `schemaVersion: 10` 的旧工程 JSON（摄像机对象手动删掉 `effectors` 字段，模拟真实旧数据），`deserializeScene` 后：
   - `schemaVersion` 为当前版本（11）
   - `editorMode === 'pro'`
   - `shots.length === 0`
   - 摄像机对象补上了空数组 `effectors`
   - `objects.length` 与迁移前一致（3 个对象）
   - `sceneSettings` 与默认值逐字段一致
   - `activeCameraId` 与迁移前一致
2. **v11 往返序列化无损**：用 `createShot` 生成一张含 3 个对象状态的镜头卡，`editorMode: 'simple'` 一起 `serializeScene` → `deserializeScene`：
   - `editorMode`、`shots.length`、`shot.id` 保持一致
   - `objectStates` 深度 JSON 比较无损
   - 摄像机对象 `effectors` 字段仍存在
3. **`captureShotObjectState` 分支正确性**：摄像机快照含 `fov`/`lookAt`、不含 `pose`；角色快照含 `pose`/`motion`、不含 `fov`。
4. **`normalizeShots` 容错**：`null`、非数组、结构不完整的元素分别得到空数组 / 空数组 / 补默认值后的合法 `StageShot`。
5. **版本上限保护**：`schemaVersion` 高于当前支持版本（12）时 `deserializeScene` 抛错，符合"高于 v11 的工程仍按现状报错"验收标准。

### 未覆盖 / 后续建议

- 未做真实 Electron 窗口内的手动保存/加载工程回归（本任务是纯 domain 层改动，UI 尚未接入 `editorMode`/`shots`，无可交互界面可测；2.1+ 接入 UI 后需要用户手动验证真实保存/加载）。
- 未验证真实项目包导入导出链路（`project-package`）是否需要感知新字段——已确认该链路只把 `sceneJson` 当不透明字符串搬运（见 `electron/main/ipc/camera-stage-projects.ts`），不需要改动。

## 1.2 快照差异编译器

### 测试基建

- 项目原无 vitest/jest。新增 `vitest@^1.6.1` devDependency + `vitest.config.ts`（`include: ['src/**/*.test.ts']`，含 `@/` alias 对齐 `vite.config.ts`）+ `package.json` `"test": "vitest run"`。此配置是通用最小配置，未针对本任务写死内容，供 1.3/1.4 等后续任务直接复用。

### 单元测试

| 命令 | 结果 |
|---|---|
| `npm run test`（vitest run） | 1 个测试文件，13 个用例，13 通过 / 0 失败 |

用例清单（`src/features/cameraStage/domain/shotCompiler.test.ts`）：

1. 两卡仅一个 box 位置变化 → 只产生 `transform.position.x` 一条轨道，关键帧时间与 hold/过渡时长吻合，`propertyPath` 可被 `getAnimatablePropByPath` 解析。
2. 未变化对象 → 零轨道。
3. 三卡中间卡 hold>0 → 用 `sampleTrack` 在停留段起点/中点/终点三处采样均为恒定值（10），验证停留段守护点生效。
4. 速度预设四种（`it.each`）→ `uniform/easeInOut/fastStart/slowStart` 分别映射为 `linear/easeInOut/easeOut/easeIn`。
5. 错峰延迟：
   - 正延迟（0.5）→ 起止时间整体后移，超出部分钳制在过渡结束时间。
   - 负延迟（-0.3）→ 起止时间整体前移，超出部分钳制在过渡开始时间。
   - 超界延迟（±100）→ 起止时间钳制到同一边界，退化为单点跳变（去重规则保留后写入的终值点，1 个关键帧）。
6. 空 shots 数组 → 空轨道、`duration === 0`；单卡 → 空轨道、`duration` 等于该卡 `hold`。
7.（补充）多对象（primitive/character/camera）综合场景：产物全部 `propertyPath` 均能被 `getAnimatablePropByPath` 解析；模拟对象在某卡缺快照时，该对象不参与该段差异（无对应轨道）。

### 静态检查

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过，无输出 |
| `npx tsc -p tsconfig.json --noEmit` | 通过，无输出 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无输出 |

### 联调中定位的问题（已修复，见 decisions.md）

- 轨道 key 反解析时按分隔符长度切片错误（`::` 是 2 字符，误用 `+1` 切片导致 `propertyPath` 带前导冒号），首轮跑测试时通过 13 个用例中 10 个失败精确定位。
- 修复过程中一度遗漏 `TRACK_KEY_SEPARATOR` 常量声明导致 `ReferenceError`，随即修复。
- 均已修复并通过全部 13 个用例回归验证。
