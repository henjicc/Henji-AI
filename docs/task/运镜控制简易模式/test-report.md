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
