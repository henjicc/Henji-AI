摘要：A 线实施中；先冻结 design.md 4.5/4.6 的契约、独立 schema 与数值夹具，再接入文档、传播和 GPU 合成。
摘要：当前基线 main/task/16-三维空间 = 1e3982dd4；未切分支、未推送、未运行 9334 实例、未访问正式作品目录。
摘要：契约阶段精确测试 15 项、依赖门禁定向测试 12 项、66 种持久格式兼容检查与文件级 ESLint 已通过；工程编译与其余实施验收进行中。

## 契约检查点

- 分支：task/16-三维空间。冻结提交：3c813ce7d1c316aeb86c48ea1fa748fb3b7fd23b（feat(video-edit): 三维空间契约与坐标曲线夹具）。B/C 可基于此提交叠加；未推送。
- `spatialTypes.ts`、`videoEditSpatialContracts.ts` 导出设计的全部数值 DTO、lease/Host/CodeSources 契约与函数类型；品牌符号有运行时导出。
- `spatialSchema.ts` 是独立 schema。该检查点尚不接入 document 的存储 schema；`SpatialClipFields` 为片段四键/开关的可选字段类型，与后续正式字段结构一致，不改变冻结接口。
- 关键帧 schema 从运行时分离，插值 schema 同源重导出；原有持久 schema 指纹不变。
- 数学复用锁定作者版 three 的 Matrix4/Vector3/Vector4；值仅以数值数组跨边界传递。新增 `spatialThree.d.ts` 只绑定现有冻结类型包，无依赖安装。
- 相邻支撑文件 `keyframeInterpolation.ts` 的 schema 重导出和 `spatialThree.d.ts` 为轻量 schema 提取/可编译别名所必需；不改变插值行为，不占 B/C 文件。

## 已执行验证

- `npx vitest run src/core/videoEdit/spatialContracts.test.ts src/core/videoEdit/keyframes.test.ts`：2 文件、15 项通过。
- `node --test scripts/check-dependency-graph.test.cjs`：12 项通过，别名静态回拉拒绝与动态加载通过均实测。
- `npm run check:persistence-compat`：66 种格式通过。
- 本次 9 个 TS/d.ts 文件 ESLint：通过。
- 默认 Node 堆上限的全工程 tsc 内存不足；后续使用 `node --max-old-space-size=12288 .../tsc`，并用 `.tmp/t16-*.tsbuildinfo` 避免共享联接点缓存。未将此失败记为通过。

## 待完成

- 文档空间字段/相机接入与迁移；求值/传播；合成、景深和曝光调度；运动 Worker 接缝。
- 改前 main 原始像素基准、P1 数据与实际 GPU 验证。
- 收尾 merge main、独立干净上下文一轮审查、修复和 L2 精确清单验证。

- 契约检查点双工程 tsc 均已通过；GPU 纹理借用采用宿主现有结构类型，避免全局 WebGPU 声明污染 Canvas 重载，字段与方法签名按冻结设计保持。

