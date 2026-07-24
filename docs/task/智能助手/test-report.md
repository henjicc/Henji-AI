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
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建，生成 65 个模型 manifest |
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

## 第四阶段 · 智能助手侧边栏

- 验证状态：代码与自动化验证通过；真实 Electron、真实 Provider 和鼠标交互待用户验收
- 验证日期：2026-07-23
- 验证范围：侧边栏容器/布局、拖动边界、事件恢复、运行控制、对话/工具/审批可视化、稳定结果跳转、受限日志诊断、IPC/PAL 与完整 Electron 构建。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 第四阶段定向测试 | 通过；6 个测试文件、14 个用例 |
| `npm test` | 通过；66 个测试文件、309 个用例全部通过 |
| `npm run lint` | 通过；renderer 零 warning |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过；Electron 零 warning |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `npm run check:colors` | 通过；无新增颜色硬编码 |
| `npm run check:model-i18n` | 通过 |
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建 |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示，无空白错误 |
| 新增文件体积检查 | 通过；第四阶段新增源码均未超过 400 行 |
| 新增原生控件/裸 `any`/颜色字面量检查 | 通过；第四阶段新增目录无命中 |

### 新增定向覆盖

- 悬浮拖动和尺寸调整的视口边界约束。
- AgentEvent eventId 去重、sequence 乱序归并、历史 hydration 与工具/审批状态聚合。
- Runner 计划事件、事件历史快照和运行状态同步。
- 诊断跨日期查询、requestId 优先、domain/时间窗降级、当前 run/Agent 域排除、字段白名单与二次脱敏。
- 全局/生成错误诊断上下文清洗、缺失 requestId 的低置信度提示和敏感 URL/本地路径移除。

### 待用户手动验证

- 标题栏入口、右侧默认唤起、左右停靠、工作区避让、悬浮拖动、边界约束、收起重开和应用重启恢复。
- 助手与素材浮层、设置窗口、全局告警之间的遮挡层级。
- 已通过 capability smoke 的真实模型对话：计划、流式回复、工具、审批、usage、暂停/恢复/取消和结果跳转。
- renderer 重载期间的事件补齐与 pending 审批恢复；应用级重启恢复不在本阶段范围。
- 全局错误和生成失败“问助手”，以及有/无 requestId 时的证据引用、置信度和敏感信息保护。

### 结论

- 4.1～4.3 实现与自动化验收通过，进入真实 Electron 手动验收。
- 手动验收通过后可进入 5.1；事件/Artifact/运行检查点的应用重启恢复按计划留到 6.1。

## 第四阶段 · 手动验收交互修复

- 验证状态：代码与自动化验证通过；鼠标手感、边缘命中和不同 DPI 实际效果待用户复验
- 验证日期：2026-07-23
- 验证范围：悬浮拖动性能路径、左右停靠宽度调整、悬浮宽高调整、尺寸/位置边界与持久化、工作区避让。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 面板交互几何定向测试 | 通过；1 个测试文件、4 个用例 |
| `npm test` | 通过；66 个测试文件、311 个用例全部通过 |
| `npm run lint` | 通过；renderer 零 warning |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `npm run check:colors` | 通过；由完整构建执行，无新增颜色硬编码 |
| `npm run check:model-i18n` | 通过；由完整构建执行 |
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建 |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示，无空白错误 |

### 自动化覆盖

- 悬浮位置受标题栏、左右和底部可视区约束，小窗口下仍保留安全位置。
- 左右停靠的内侧边缘拖动方向正确，宽度受 320px 最小面板和最小工作区约束。
- 悬浮态可分别或同时改变宽高，并受当前坐标对应的右下可视区约束。
- 高频位置拖动采用逐帧视觉更新，最终状态只在交互结束后提交；尺寸性能路径随后由下节二次修复替代。

### 待用户手动验证

- 悬浮标题栏快速、慢速和连续拖动，确认面板贴合指针且没有原先的轻微滞后。
- 左停靠拖右边缘、右停靠拖左边缘，确认宽度调整、最终工作区避让和持久化正确。
- 悬浮态拖右边缘、下边缘、右下角，确认宽度、高度、双向调整和边界限制。
- 收起重开、切换三种形态及应用重启后，确认尺寸与悬浮位置保持。

## 第四阶段 · 尺寸性能二次修复

- 验证状态：代码与自动化验证通过；真实鼠标跟手性与合成层缩放视觉待用户复验
- 验证日期：2026-07-23
- 根因：尺寸 `pointermove` 每帧更新 `documentElement` 根级宽高变量；停靠态同步改变工作区 padding，悬浮态同步改变助手真实宽高，导致整棵渲染树样式重算、复杂工作区布局与完整对话内容回流。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 面板交互定向测试 | 通过；1 个测试文件、5 个用例 |
| `npm test` | 通过；66 个测试文件、312 个用例全部通过 |
| `npm run lint` | 通过；renderer 零 warning |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| 根级助手宽高变量静态检查 | 通过；运行时代码无写入或消费 |
| 新增文件体积检查 | 通过；交互 Hook 379 行，侧边栏 159 行 |
| `npm run check:colors` | 通过；由完整构建执行 |
| `npm run check:model-i18n` | 通过；由完整构建执行 |
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建 |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示，无空白错误 |

### 性能路径结论

- 尺寸 `pointermove` 只计算受约束的目标尺寸，并通过 `requestAnimationFrame` 更新外层 `transform`；没有 React/Zustand 状态写入。
- 拖动帧不改变真实 width/height、工作区 padding 或根级尺寸变量，因此不会再主动触发复杂工作区与助手内容的逐帧布局。
- pointerup 只执行一次真实尺寸、工作区避让和持久化提交；代码层面已消除本轮反馈对应的结构性卡顿来源。

### 待用户手动验证

- 在生成、画布、工具箱等不同工作区分别调整左右停靠宽度，确认拖动过程流畅，松手后工作区一次性对齐。
- 悬浮态分别调整宽、高和双向尺寸，确认拖动预览流畅，松手后文字/卡片恢复清晰且尺寸正确。
- 在高 DPI 和窗口接近最小尺寸时复验边界、锚点和最终持久化结果。

> 本节的合成层缩放预览方案因拖动期间内容变形被第三轮反馈否决，已由下节实时排版方案替代。

## 第四阶段 · 实时排版性能修复

- 验证状态：代码与自动化验证通过；真实鼠标跟手性与复杂工作区实时排版待用户复验
- 验证日期：2026-07-23
- 目标：拖动期间按真实尺寸持续重排助手内容和停靠工作区，同时避免根级样式失效、React/Zustand 高频更新与长对话全量布局。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 面板交互定向测试 | 通过；1 个测试文件、5 个用例 |
| `npm test` | 通过；66 个测试文件、312 个用例全部通过 |
| `npm run lint` | 通过；renderer 零 warning |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| 旧缩放预览与根级尺寸变量静态检查 | 通过；运行时代码无 `scale3d` 和 `--assistant-panel-width/height` 残留 |
| 文件体积检查 | 通过；交互 Hook 376 行，侧边栏 165 行，其余改动文件均低于 400 行 |
| `npm run check:colors` | 通过；由完整构建执行 |
| `npm run check:model-i18n` | 通过；由完整构建执行 |
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建 |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示，无空白错误 |

### 性能路径结论

- 尺寸事件先写入 ref，再由单个 `requestAnimationFrame` 批量写助手局部真实 `width/height`；左右停靠只额外写当前工作区容器的对应 padding，因此内容和工作区在拖动中按真实尺寸排版。
- 高频帧不修改 React 状态、Zustand、根级 CSS 变量，也不让 `App` 对话树重渲染；最终尺寸仅在 pointerup 提交一次用于持久化。
- 助手使用布局/样式 containment；长对话离屏块使用 `content-visibility: auto` 与固有尺寸占位，避免不可见的 Markdown、工具和审批内容在每个尺寸帧重复布局/绘制。

### 待用户手动验证

- 在画布、生成、3D 镜头和工具箱分别以左右停靠调整宽度，确认助手内容与工作区实时重排、文字不拉伸、窗口无明显卡顿。
- 在长对话中滚动到包含 Markdown、多个工具卡和审批卡的位置，再调整悬浮宽、高和右下角，确认拖动中排版清晰连续，松手前后没有跳变。
- 在高 DPI、窗口接近最小尺寸以及快速往返拖动时复验边界、跟手性和最终尺寸持久化。

## 第五阶段 · 闭环验证

- 验证状态：代码与自动化门槛通过；真实 Provider、Electron 鼠标交互和 JSONL/日志窗口抽查待用户验收
- 验证日期：2026-07-23
- 验证范围：生成/诊断首闭环、C2 审批与安全护栏、画布目录/添加/连接/定位/撤销、最小评测与完整构建。

### 已执行检查

| 检查 | 结果 |
|---|---|
| `npm run test:assistant-eval` | 通过；7 个测试文件、22 个用例全部通过 |
| `npm test` | 通过；70 个测试文件、325 个用例全部通过 |
| `npm run lint` | 通过；renderer 零 warning |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过；Electron 零 warning |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `npm run check:colors` | 通过；无新增颜色硬编码 |
| `npm run check:model-i18n` | 通过 |
| `npm run electron:build` | 通过；生成 65 个模型 manifest，main/preload/renderer 均成功构建 |
| 新增源码文件体积检查 | 通过；全部低于 400 行 |
| 新增原生控件/裸 `any`/颜色字面量检查 | 通过；无新增违规命中 |

### 最小评测确定性基线

- 生成、诊断、画布三类合成运行各重复 3 次，成功率均为 100%。
- 统一验证期望工具、禁止工具、必需参数键、run/tool 日志 start/terminal 成对和敏感探针不出现在捕获输出。
- 评测器可汇总成功率、平均/p95 延迟、input/output/total token，并为失败断言输出明细；测试已证明缺工具、禁用工具、日志不成对和敏感探针会导致失败。
- 以上是确定性代码基线，不代表真实 Provider 稳定性；真实模型数据必须在 `最小评测结果.md` 中另行记录。

### 新增定向覆盖

- 画布添加/连接/撤销的项目持久化、类型连接、循环/重复边拒绝、非法路径与错误项目保护、节点定位。
- 同一模型响应连续执行多个画布写工具时，后一步使用前一步 resulting canvas revision。
- 画布工具只在宿主发布对应 command/query 时进入 active tools；无项目时不发布写命令。
- 诊断 preview 的具体字段/目标/用途、批准/拒绝/过期、C3 阻断、R4 注册拒绝和宿主错误码映射。
- Bearer、常见 sk/pk/rk/key 前缀和敏感键值对的上下文/工具结果脱敏。

### 待用户手动验证

- 使用已通过 capability smoke 的真实 Profile，按首用例脚本完成可见生成任务和日志诊断，检查 taskId 跳转、C2 单次审批、证据准确性与无敏感原文。
- 按护栏清单验证真实取消、暂停/恢复、批准/拒绝/过期、renderer 重载、非法参数/注入和 runId/toolCallId 日志解释。
- 按画布脚本完成上传节点与图片节点的创建、连接、定位、项目切换冲突、重开持久化和严格撤销。
- 三类真实用例各重复至少 3 次，补录成功率、工具/参数、平均/p95 延迟、token、已知费用和失败明细。
- 在现有日志窗口/JSONL 中抽查敏感探针、run/tool/approval/frontend action 成对事件；未通过前第五阶段保持待验证。

### 结论

- 5.1～5.4 所需代码、自动化、脚本和记录已经齐备，没有代码阻塞。
- 真实 Provider 与 Electron 验收未执行，因此第五阶段不标记完成，也不提前进入 6.1。

## 第五阶段 · 模型选择描述与偏好补充优化

> 本节保留结构化模型偏好方案的历史验证记录；该偏好实现已由下节“自然语言用户指令与上下文边界调整”替代。

- 验证状态：代码与自动化门槛通过；设置页、手工编辑偏好文件和真实对话选型待用户验收
- 验证日期：2026-07-23
- 验证范围：中央模型描述、65 个供应商模型迁移、偏好文件/IPC/PAL、Agent 工具与路由、设置页和完整 Electron 构建。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 中央描述与偏好定向测试 | 通过；3 个测试文件、13 个用例 |
| `npm run test:assistant-eval` | 通过；7 个测试文件、24 个用例 |
| `npm test` | 通过；72 个测试文件、332 个用例 |
| `npm run lint` | 通过；renderer 零 warning |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过；Electron 零 warning |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `npm run gen:model-manifest` | 通过；生成 65 个模型 |
| `npm run check:model-i18n` | 通过 |
| `npm run check:colors` | 通过 |
| 两套适配 Skill `quick_validate.py` | 通过；均为有效 Skill |
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建 |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示，无空白错误 |

### 自动化覆盖

- 65 个供应商模型都声明 `canonicalModelId`、都命中 43 条中央目录，且供应商模型元数据不再直接声明描述。
- 同一偏好增量更新只改指定媒体类型，不清空其他偏好；重复条目被归一化，未知字段被拒绝。
- “记住/优先/避免某供应商或模型”命中持久偏好工具域；系统提示固定能力硬约束与选型优先级。
- 完整构建验证主进程偏好服务、preload IPC、渲染层设置和模型注册链路能够共同产出。

### 待用户手动验证

- 在设置页保存、重新读取、恢复默认并打开偏好文件，确认同一份数据双向同步；手工制造无效 JSON 时确认应用明确报错且不覆盖原文件。
- 通过对话要求助手“以后优先使用 PPIO”“图片优先 Seedream 4.5”“避免某模型”，确认出现 R2 审批，批准后下一次生成按偏好排序。
- 在当前请求明确指定其他兼容模型，确认当前要求能覆盖持久偏好；给出不兼容输入时确认偏好和描述不能越过 tags/schema 硬约束。
- 在中央描述文件补充文案并重启，确认同一模型的不同供应商变体读取同一描述。

## 第五阶段 · 自然语言用户指令与上下文边界调整

- 验证状态：代码与自动化门槛通过；设置页、外部文件编辑、R2 对话更新和真实模型选型待用户验收
- 验证日期：2026-07-23
- 验证范围：用户指令契约、Markdown 持久化、IPC/PAL、Agent 工具/路由、高优先级边界与秘密脱敏、设置页和 Electron 构建。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 用户指令、上下文与网关脱敏定向测试 | 通过；3 个文件、18 个用例 |
| `npm run test:assistant-eval` | 通过；7 个文件、25 个用例 |
| `npm test` | 通过；72 个文件、335 个用例 |
| `npm run lint` | 通过；renderer 零 warning |
| Electron ESLint | 通过；零 warning |
| renderer / Electron TypeScript | 通过 |
| `npm run check:colors` | 通过 |
| `npm run check:model-i18n` | 通过 |
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建，生成 65 个模型 manifest |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示，无空白错误 |

### 自动化覆盖

- 自然语言内容换行归一化、空白默认、4000 字上限、凭据与无法覆盖规则提示。
- “长期记住供应商/模型/回答风格”命中 `user_instructions` 工具域；读取和更新工具仍经唯一网关与 R2 审批。
- 用户指令以明确边界标记注入，不进入 system role；安全/权限/真实能力保持硬约束，产品默认、推荐策略和通用描述不能覆盖兼容的用户指令。
- API Key、token、Cookie、授权头、客户端密钥、私钥和密码等凭据形态在进入模型前脱敏；普通本地路径、带查询参数网址和其他正常自然语言保持原样。
- 模型能力硬约束、当前请求优先级、最多 8 个 active tools、历史压缩和大 observation offload 保持有效。

### 待用户手动验证

- 在“助手用户指令”输入多行自然语言，保存、重新读取、打开外部 Markdown、清空，确认 UI 与文件同源。
- 若本地已有旧 `model-preferences.json`，确认它不会被读取或迁移，也不会影响空白或现有 `user-instructions.md`。
- 对助手说“以后图片优先 PPIO，回答简洁”，批准 R2 更新；下一次 run 确认指令能覆盖产品默认、推荐策略和通用描述，当前明确要求仍能覆盖持久化指令。
- 在指令中输入凭据形态或“自动批准”等内容，确认 UI 提示，运行上下文不出现凭据原文且安全/审批规则不被覆盖。
- 在指令中输入普通本地路径和带查询参数网址，确认保存后内容不被删改且可用于当前任务。
- 确认普通对话不会被助手擅自写入长期记忆；真正的自动记忆、历史持久化和相关性检索等待 6.1/6.5。

## 第五阶段 · 图片生成误路由与能力发现修复

- 验证状态：代码与自动化门槛通过；真实 Provider 生成待用户复验
- 验证日期：2026-07-23
- 真实证据：run `8aa28be8` 未命中“照片”确定性规则，router 结构校验失败后降级为 `general/catalog`；两次目录调用均为 0 项并结束，未进入模型目录或生成工具。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 生成路由/能力目录/Runner 定向测试 | 通过；5 个文件、23 个用例 |
| `npm run test:assistant-eval` | 通过；8 个文件、30 个用例 |
| `npm test` | 通过；73 个文件、340 个用例 |
| renderer / Electron ESLint | 通过；零 warning |
| renderer / Electron TypeScript | 通过 |
| `npm run check:colors` | 通过 |
| `npm run check:model-i18n` | 通过 |
| `npm run electron:build` | 通过；main/preload/renderer 均成功构建，生成 65 个模型 manifest |

### 自动化覆盖

- 截图原句“生成一张剪纸风格的猫咪的那种照片”不调用 router 模型，直接进入 `models + generation + navigation`。
- router 模型即使返回错误 path/toolDomains，也只能影响分类建议，实际执行路径和工具域由本地策略映射。
- “KIE 图片生成”能发现创建任务、模型搜索和工作区切换能力；发现结果经 Registry 复核后在下一轮 active tools 生效。
- 生成 route 在宿主就绪时同时获得模型搜索、schema、可见任务与工作区切换工具；模型内容/风格不会误作目录 query。

### 待用户手动验证

- 重启 Electron 后原样重试截图中的生成语句；确认不再出现两个“搜索应用能力 0 项”卡片。
- 在非生成工作区发起同一请求，确认先切换生成工作区，再搜索模型、读取 schema 和请求 R2 生成审批。
- 批准后确认生成工作区出现真实可见任务；真实 Provider 费用、输出和延迟仍按第五阶段脚本记录。

## 第五阶段 · 手动反馈架构纠偏与交互修复

- 验证状态：代码与自动化通过；真实 Electron 鼠标、真实 Provider 与三种批准方式待最终统一验收
- 验证日期：2026-07-23

### 已执行检查

| 检查 | 结果 |
|---|---|
| 语义路由、批准方式、诊断、AI SDK、KIE 网络与 Seedance 默认值定向测试 | 通过；6 个文件、35 个用例 |
| `npm test -- --run` | 通过；75 个文件、348 个用例 |
| renderer / Electron TypeScript | 通过 |
| 相关 renderer / Electron ESLint | 通过；零 warning |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示 |

### 自动化覆盖

- 画布、长期偏好和“照片”等自然表达均调用 router 模型；模型输出不能自定义工具域。
- `ask / assistant_decides / full_access` 分别覆盖逐次审批、只读 R2 自动执行、R2 写入自动执行和 R3 强制确认。
- system 提示经 AI SDK 独立选项传递，messages 中不再出现 system role 或安全警告。
- KIE 连接前超时只重试一次；socket 状态不明与中止请求不重试。
- KIE Seedance 2.0 / Fast / Mini 的音频参数首屏默认关闭，builder 缺少显式开关时发送 `generate_audio: false`。
- 诊断每 run 最多查询一次、最多 16 条证据，进入上下文时最多保留 10 条紧凑字段。
- 生成工具返回 `submitted`，最终文本规则禁止在 Provider 完成前宣称成功。

### 待最终统一手动验证

- 在三种批准方式下分别执行只读诊断、生成任务和高风险操作，确认自动执行/逐次确认符合说明。
- 观察含长消息、Markdown 和多条工具轨迹时的悬浮拖动与缩放手感。
- 复现一次 KIE 临时断网，确认错误包含稳定网络码且任务列表没有重复任务。
- 确认诊断答复先给结论、原因和步骤，GFM 列表/代码/链接可读，工具轨迹默认单行折叠。

## 第六阶段 · 开始基线

- 基线提交：`a85dbe4`
- 基线自动化：75 个测试文件、348 个用例通过；renderer/Electron TypeScript、前后端 ESLint、颜色与模型 i18n 检查通过。
- 本阶段新增验证目标：SQLite migration/往返/版本不匹配/安全恢复、三类评测集、utilityProcess 握手/心跳/崩溃、记忆隐私/过期/冲突/删除和最终长稳。

## 第六阶段 · 持久化、独立进程与记忆治理

- 验证状态：代码与自动化通过；真实 UI 操作、真实 Provider、崩溃体验和 30～60 分钟长稳并入最终统一验收
- 验证日期：2026-07-23

### 已执行检查

| 检查 | 结果 |
|---|---|
| `npm run test:assistant-persistence` | 通过；Electron ABI 下 SQLite 真库 6/6 |
| `npm run test:assistant-eval` | 通过；9 个文件、33 个用例 |
| 记忆策略与 SQLite 存储定向测试 | 通过；普通 Node 策略测试与 Electron ABI 真库测试均通过 |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `npx electron-vite build` | 通过；产出 `out/main/agent-utility.cjs` |
| `npm run electron:assistant-utility-smoke` | 通过；完成 `agent-utility/v1` 握手 |

### 自动化覆盖

- migration 幂等、run/checkpoint/event/artifact 往返、版本不匹配、安全恢复和新 run 重试。
- utilityProcess 版本握手；main/utility 契约 schema、心跳、取消和进程退出恢复由实现路径覆盖。
- 长期记忆默认关闭、秘密/完整日志/文件/提示词拒绝、候选确认、TTL、冲突替换审计、编辑删除清空与相关性检索。
- 黄金、历史失败、对抗评测覆盖工具次数、嵌套参数、禁止动作、批准风险、日志成对、安全、延迟、token 和可证实费用。

### 待最终统一手动验证

- 重启应用后检查运行历史、`recovery_required` 和显式重试，确认旧工具调用不自动重放。
- 启用记忆后验证候选确认/拒绝、编辑、TTL、冲突、删除、二次确认清空；确认凭据和安全规则不会保存。
- 运行中终止 utilityProcess 并观察提示、历史与后续新 run；连续使用 30～60 分钟抽查 CPU、内存、事件顺序和 JSONL 关联。

### 结论

- 第六阶段实现没有代码阻塞；6.1、6.2 完成，6.4、6.5 保持待验证，6.3 按真实需求门槛取消。

## 第七阶段 · 开始基线

- 基线提交：`437c0e3`
- 基线自动化：助手评测 9 文件、33 用例，SQLite 真库 6/6，renderer/Electron TypeScript、utilityProcess 构建与版本握手通过。
- 本阶段新增验证目标：全量模型 schema 矩阵、项目/节点/边/批量 revision 与撤销、各内置领域稳定 ID/审批/补偿，以及至少 3 个代码持序的跨工作区工作流。

## 第七阶段 · 内置能力全面接入实现收口

- 验证状态：代码与自动化门槛通过；真实 Provider、真实 Electron 交互、日志抽查和长稳待最终统一手动验收
- 验证日期：2026-07-24
- 验证范围：生成/模型目录、画布项目/节点/边/批量、工具箱/3D/分镜/图片编辑/素材、utility registry 和三个确定性跨工作区工作流。

### 已执行检查

| 检查 | 结果 |
|---|---|
| 工具箱/图片编辑定向测试 | 通过；2 个文件、3 个用例 |
| `npm run test:assistant-eval` | 通过；9 个文件、33 个用例 |
| `npm test -- --run` | 通过；80 个测试文件、363 个用例；2 个文件、6 个用例按环境跳过 |
| `npm run lint` | 通过；renderer 零 warning |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过；Electron 零 warning |
| `npx tsc --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `npm run gen:model-manifest` | 通过；生成 65 个模型清单 |
| `npm run check:model-i18n` / `npm run check:colors` | 通过 |
| `npm run electron:build` | 通过；main/preload/renderer/utility 均成功构建 |
| `npm run electron:assistant-utility-smoke` | 通过；完成 `agent-utility/v1` 握手 |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示 |

### 自动化覆盖

- 3D 工程重命名/删除、对象复制/删除/更新、图片编辑 preview/commit、分镜 list/get 已进入 registry，并按宿主 available command/query 过滤。
- 图片编辑标记使用共享 discriminated union；非法类型、几何、样式、奇数点集和超界裁剪在入口拒绝。
- 3D/分镜查询结果不再包含完整场景/节点/边 JSON，只包含稳定 ID、计数和最多 32 项摘要详情。
- 画布批量提交使用单次历史组与 resulting revision；跨工作区工作流只使用固定代码步骤和 gateway 子调用，支持 ref 传递、暂停、恢复、取消、revision 冲突与补偿。

### 待用户手动验证

- 重启 `npm run electron:dev` 后按《第七阶段-最终手动测试清单.md》执行，不要只用裸 Vite 页面判断桌面能力。
- 真实 Provider 生成/状态/取消、三种批准方式、3D/图片编辑/素材删除审批、画布鼠标交互、三个跨工作区工作流和长稳仍未由自动化代替。

## 第七阶段 · 最终自动验证复验

- 验证日期：2026-07-24
- 验证状态：代码与自动化门槛通过；真实 Provider、真实 Electron 交互、日志抽查和长稳仍待用户手动验收。

### 本轮新增修复

- `asset_edit_to_canvas` 工作流原先只创建空上传节点；现改为调用 `add_asset_to_canvas`，将素材提交步骤返回的 `assetId` 绑定到画布节点。
- 工作流仍由代码固定步骤顺序，模型只提供语义参数和引用，不可绕过统一工具网关。

### 最终执行结果

| 检查 | 结果 |
|---|---|
| `npm test -- --run` | 通过；80 个测试文件、363 个用例；2 个文件、6 个用例按环境跳过 |
| `npm run test:assistant-eval` | 通过；9 个文件、33 个用例 |
| `npm run electron:build` | 通过；main/preload/renderer/utility 均成功构建 |
| `npm run electron:assistant-utility-smoke` | 通过；`agent-utility/v1` 握手成功 |
| `git diff --check` | 通过；仅有仓库 CRLF 转换提示，无空白错误 |

### 仍需手动验证

- 按《第七阶段-最终手动测试清单.md》验证素材编辑后加入画布时节点确实引用新素材，而不是空上传节点。
- 继续验证真实 Provider、三种批准方式、鼠标交互、跨工作区失败补偿、日志窗口/JSONL 和 30～60 分钟长稳。
