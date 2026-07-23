# 智能助手验证报告

## 第一阶段 · 架构与方案定稿

- 验证状态：通过
- 验证日期：2026-07-23
- 验证范围：任务文档完整性、契约一致性、代码基线引用、跨文档状态同步和 Git 文本质量。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 阶段交付物存在与行数 | 通过；四份交付物分别为 394、179、365、258 行，均未超过 500 行 |
| 关键源码引用存在 | 通过；App、可见生成 Hook、日志查询、IPC registry、nodeRegistry 等路径均存在 |
| 本地 Markdown 链接解析 | 通过；总览、实施方案、重要记录和第一阶段任务目录无失效本地链接 |
| 关键契约术语检索 | 通过；唯一 Runner、可见生成任务、scope revision、不可信 observation 均已落入对应交付物 |
| `git diff --check` | 通过；无空白错误 |
| AI SDK 6 接口核验 | 通过；官方文档确认 Core 单 generation、自定义循环、`Output.object()` 和 usage 字段 |
| 任务状态同步 | 通过；总览、1.1～1.4 和阶段记录均标记第一阶段已完成 |

### 代码测试说明

- 本阶段为纯设计任务，没有业务代码、依赖、manifest 或 seeds 改动，因此未运行 `npm run lint`、TypeScript 编译、Electron build/smoke。
- 不涉及鼠标、窗口或真实 Electron UI 交互，无需用户手动操作验收。

### 结论

- 1.1～1.4 的验收项全部满足，可以进入 2.1。
- token、router、压缩阈值属于初始设计值，后续在 5.4/6.2 以真实模型和评测集校准。

## 第二阶段 · 宿主可操控化改造

- 验证状态：代码与自动化验证通过；真实 Provider 和鼠标交互待用户验收
- 验证日期：2026-07-23
- 验证范围：导航单一状态源、宿主命令/查询、frontend 往返、可见生成任务、AI SDK 单步、Agent Profile、能力 smoke、配置迁移与 Electron 构建。

### 已执行检查

| 检查 | 结果 |
|---|---|
| `npm test` | 通过；55 个测试文件、280 个用例全部通过 |
| `npm run lint` | 通过；renderer 无 warning |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过 |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `npm run check:colors` | 通过；无新增颜色硬编码 |
| `npm run check:model-i18n` | 通过 |
| `npm run electron:build` | 通过；main/preload/renderer 均成功打包，AI SDK ESM/CJS 兼容 |
| `git diff --check` | 通过；仅有仓库既有 CRLF 提示，无空白错误 |
| `npm run electron:smoke` | 未通过；唯一 console error 为用户历史外部媒体路径的 `henji-media://` 403，诊断确认与本阶段改动无关，未修改用户数据 |

### 新增定向覆盖

- 导航与素材联动、HostContract、写命令 revision 冲突、稳定返回值。
- AI SDK 文本/reasoning 流、单步 tool-call、`Output.object()`、response messages、usage、能力裁剪、Provider 原生参数、取消与错误分类。
- capability smoke 六项结果聚合、真实 token 汇总与费用 unknown。
- Agent Profile 旧配置迁移、router/summarizer 复用 primary、已验证 fallback 与明确阻断。
- 提示词优化既有测试随全量测试通过，旧手写流式路径保留。

### 待用户手动验证

- 四个工作区切换、素材库完整/悬浮模式、Esc 关闭、从 assets 返回来源工作区和工具箱子工具状态。
- 打开画布项目、添加节点和创建可见生成任务的实际 UI 结果。
- 使用用户选择的真实模型运行 capability smoke，核对文本、工具、结构化输出、流、usage、取消以及失败提示。

### 结论

- 第二阶段代码可以交付手动验收；未发现代码阻塞。
- 用户验收通过后可进入 3.1；真实 smoke 结果将成为 Runner 启动前能力判断依据。

## 第二阶段 · 真实模型验收修复

- 验证状态：自动化验证通过；修复后的 DeepSeek 真实 smoke 待用户重启后复验
- 验证日期：2026-07-23
- 根因：DeepSeek 返回 “This response_format type is unavailable now”，日志确认适配层把 JSON 对象能力错误映射成了 `response_format: json_schema`。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 定向测试 | 通过；3 文件、10 用例 |
| `npm test` | 通过；56 个测试文件、283 个用例全部通过 |
| `npm run lint` | 通过 |
| Electron ESLint | 通过；零 warning |
| renderer / Electron TypeScript | 通过 |
| `npm run check:colors` | 通过 |
| `npm run check:model-i18n` | 通过 |
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建 |
| DeepSeek 官方 JSON Output 契约 | 通过；当前仅声明 `json_object`，并要求提示词包含 JSON 与示例 |
| `git diff --check` | 通过；无空白错误 |

### 待用户手动验证

- 重启 `npm run electron:dev`，重新点击 DeepSeek 的“验证此模型”。
- 确认 `structuredOutput` 变为“通过”，六项均通过。
- 确认静态摘要自动更新为“工具 是 · 结构化 json”；上下文/最大输出未知不影响本次 capability smoke。

## 第三阶段 · 运行时内核

- 验证状态：通过
- 验证日期：2026-07-23
- 验证范围：唯一 Runner、状态机与预算、事件顺序、模型选择、工具网关、审批/幂等/并发、首批 8 工具、上下文路由、压缩/offload、IPC/PAL 和 Electron 构建。

### 已执行检查

| 检查 | 结果 |
|---|---|
| Runner/网关/宿主查询定向测试 | 通过；3 个测试文件、11 个用例 |
| `npm test` | 通过；62 个测试文件、300 个用例全部通过 |
| `npm run lint` | 通过；renderer 零 warning |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过；Electron 零 warning |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `npm run check:colors` | 通过；无新增颜色硬编码 |
| `npm run check:model-i18n` | 通过 |
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建 |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示，无空白错误 |

### 新增定向覆盖

- final、tool-call、R2 审批等待/恢复、observation 回注、取消传播与事件 sequence 严格递增。
- 非法状态迁移、turn/tool/token/时长/失败/重复/无进展预算和 action final 证据门槛。
- 输入输出 schema、R4 禁止、revision 冲突、审批单次绑定、幂等缓存、并发键、超时与安全重试。
- 明确请求确定性路由、模糊请求 router 降级、active tools 裁剪、脱敏、不可信 observation、压缩与 Artifact offload。
- 宿主查询资源不存在时稳定返回 `NOT_FOUND`，避免 frontend bridge 不回传导致 main 超时。

### 手动验证说明

- 第三阶段未新增可直接操作的 UI，按项目约定没有代替用户执行鼠标验证。
- 完整真实模型 Runner 闭环需等待 4.2 提供对话/执行入口，并在 5.1 使用用户选择且已通过 capability smoke 的 Provider 验收。

### 结论

- 3.1～3.3 的代码与自动化验收项全部通过，可以进入 4.1。
- 大结果当前仅进程内 offload，检查点/Artifact 持久化按计划留到 6.1；token、路由与压缩阈值留到 5.4/6.2 校准。
