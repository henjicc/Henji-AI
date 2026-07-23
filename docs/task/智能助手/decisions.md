# 智能助手决策记录

## 已确认决策

### D-001 唯一循环与 AI SDK 边界

- `agent-contract/v1` 由自研 Runner 持有唯一循环、预算、审批、取消、检查点和状态机。
- AI SDK 6 仅负责单步 `streamText/generateText`、原生 tool-call、`Output.object()` 和 actual usage。
- Agent 工具不给 SDK `execute`，不启用多步 `stopWhen`，不使用 `ToolLoopAgent` 自动循环。

### D-002 宿主上下文并发控制

- snapshot 同时使用 `rendererSessionId`、全局 revision 和 navigation/generation/canvas/toolbox/assets scope revision。
- 写工具必须携带明确目标 ID，只比较所声明的 scope；session 或相关 scope 变化返回 `STALE_CONTEXT`。

### D-003 frontend 工具协议

- 固定 request → acknowledged → completed/failed。
- ack 只表示认领；callId、idempotencyKey、deadline 和 resulting revision 共同处理超时、重载与去重。
- ack 后状态未知的写操作不得自动重放。

### D-004 工具权限与审批

- 风险使用 R0～R4：自动、run 内具体 scope、逐次 preview、高风险逐次确认、禁止。
- approval 绑定 run/tool/version/参数摘要/目标/revision/preview/scope/有效期并单次消费。
- 通用 Shell、任意文件、任意网络、通用 IPC、读取凭据和鼠标模拟均为 R4。

### D-005 提示词与上下文

- 系统上下文按 P0～P8 分层；用户附加提示只能表达偏好，不能覆盖产品规则。
- 确定性路由优先，router 只在模糊或跨域输入时调用；activeTools 默认不超过 8 个。
- 单次 primary 输入目标 20k tokens；工具结果超过 8 KiB/100 条/可靠估计 2k tokens 时 offload。
- token/成本权威数据来自 AI SDK usage；价格未知时不显示伪精度。

### D-006 数据分类与跨工具流动

- 数据分为 C0 公开、C1 项目、C2 敏感、C3 秘密。
- 所有外部 observation 均标为 `untrusted_observation`；摘要继承最高数据分类。
- C2 外发必须展示具体字段、目标和用途并逐次确认；C3 永不进入模型、日志或 renderer。

### D-007 MVP 工具边界

- 首批为 8 个工具：能力搜索、工作区切换、模型搜索、模型 schema、创建可见生成任务、读取生成任务、取消生成任务、诊断日志。
- `create_visible_generation_task` 必须抽取 `useTaskGeneration.handleGenerate()` 的完整业务编排，不能直接调用 `GenerationService.generate()`。

### D-008 导航与宿主命令单一入口

- `navigationStore` 是工作区与工具箱子工具的唯一状态源；素材库开合通过稳定命令协调，不在 Agent 中复制 UI 状态。
- renderer 只注册声明式 HostCommand/HostQuery handler；main 通过窄 IPC 发送 request/ack/result/cancel，不导入 renderer store、组件或 Hook。
- 可见生成任务的完整编排抽到应用命令，UI 与未来 Agent 共用同一路径。

### D-009 模型单步与能力验证

- 锁定 `ai@6.0.234`、`@ai-sdk/openai-compatible@2.0.62`、`zod@4.4.3`；SDK adapter 每次只执行一个 `streamText`。
- 静态能力表与动态 capability smoke 同时参与 Agent 模型可用性判断；主模型不合格时仅允许切换到已验证 fallback，否则返回明确设置入口。
- capability smoke 由用户显式触发真实最小请求；记录 token 与延迟，缺少可靠价格时费用固定为 `unknown`。

### D-010 结构化输出模式与能力同步

- `ModelStepCapabilities` 使用 `none/json/schema` 区分不可用、JSON 对象和原生 JSON Schema，不再用单一布尔值混淆两类 Provider 能力。
- AI SDK OpenAI-compatible Provider 仅在 `schema` 模式启用 `supportsStructuredOutputs`；`json` 模式发送 `json_object`，仍由 `Output.object()` 在本地按 schema 解析和校验。
- capability smoke 对未声明/schema 以外的模型先验证 `json` 基线；验证成功的文本、流式、工具、结构化输出和 usage 会提升静态能力，失败项不自动降低用户已有声明。

### D-011 运行时契约与并发边界

- `agent-runtime/v1` 与 `agent-event/v1` 使用共享 Zod schema，在 IPC 双侧校验；事件按 run 内 sequence 严格递增。
- main 侧 `AgentRunner` 是唯一循环所有者，同一 thread 只允许一个 active run；暂停、审批等待、取消和终态由显式状态机控制。
- Runner 仅调用已通过 capability smoke 的模型角色；action final 必须有工具 observation 证据，防止模型伪报执行成功。

### D-012 唯一工具网关与审批凭证

- frontend/backend 工具共用一个 main 权威注册表与网关，固定执行 schema、上下文 revision、preview/approval、幂等、并发、超时/重试、output schema、数据分类和日志管线。
- R2/R3 每次审批，R1 仅在缺少本次明确用户意图时审批；R4 禁止注册和执行。
- approval 单次消费并绑定 run、tool call、版本、参数摘要、目标、revision、权限 scope、preview 和有效期；renderer 只能执行网关派发的窄命令/查询。

### D-013 上下文路由与大结果处理

- 明确导航、生成、模型/任务查询、取消和诊断请求走确定性路由；只有模糊请求才调用 router，router 失败时保守回退 primary。
- 每轮最多向模型暴露 8 个 active tools；工具、模型和能力信息通过目录搜索及单项 schema 渐进发现。
- 大 observation 超过 8 KiB、100 条或约 2k tokens 时 offload 为 `ArtifactRef`；第三阶段使用进程内存储，持久化与恢复留到 6.1。
- 工具结果始终标记 `untrusted_observation` 并脱敏；C3 在网关阻断，不进入模型上下文。

### D-014 助手容器单点挂载与布局所有权

- 助手侧边栏只在 `App` 根层挂载一次，独立 `assistantUiStore` 是开合、形态、坐标、尺寸和当前 run 引用的单一状态源。
- 左右停靠通过 `TabContainer` 布局内边距让工作区主动避让；悬浮态受可视区边界约束，层级高于普通业务浮层、低于设置和系统告警。
- 布局偏好持久化，具体会话与运行检查点不在 renderer 持久化，避免形成第二套运行时真相源。

### D-015 事件恢复与审批到期由主运行时收口

- `AgentEvent` 在 main 保留最多 2000 条进程内历史，renderer 以 `runId + sequence/eventId` 去重排序，并通过 `getRunSnapshot` 补齐重载期间事件。
- 同一主窗口发生 renderer session 变化时，运行时允许安全重绑定；应用重启后的恢复仍由 6.1 检查点持久化负责。
- 审批有效期由 main Runner 定时收口并发出 `expired` 事件，renderer 只展示和回传决定，不能自行推进状态机。

### D-016 诊断只读取受限日志证据

- `query_diagnostic_events` 直接复用 main 现有 logging query，最多查询 30 分钟、3 页和 40 条证据，不读取任意路径或建立平行日志通道。
- 关联顺序为 requestId 优先、domain + 时间窗其次、纯时间窗最后；排除当前诊断 run、`main.agent_*` 和助手 UI 自身日志，避免递归证据。
- 返回内容使用字段白名单、二次脱敏、短摘要和证据编号；没有 requestId 时必须降低置信度，系统提示要求区分事实/推断且不得声称已修复。

### D-017 高频面板交互不经过 React 状态帧

- 悬浮位置拖动经 `requestAnimationFrame` 合并并更新外层 `translate3d`；尺寸拖动在同一动画帧内直接更新助手局部真实 `width/height`，停靠态只同步更新对应工作区容器的局部 padding，保证内容与工作区实时排版且不变形。
- 高频临时值保存在 ref，禁止逐帧写 React 状态、Zustand 或 `documentElement` 根级变量；交互结束后再一次性把最终坐标/尺寸提交到 `assistantUiStore`，提交帧临时关闭布局过渡。
- 助手容器使用布局/样式 containment；长对话的计划、工具、审批、Artifact、Markdown 与错误块使用 `content-visibility: auto` 和固有尺寸占位，让离屏内容跳过尺寸帧的布局与绘制。
- 左右停靠至少保留 320px 工作区，悬浮态受标题栏、右侧和底部可视区约束；鼠标与键盘调整复用同一几何函数。

### D-018 画布闭环使用受限目录、确定性布局和严格撤销栈

- 第五阶段只开放上传节点与图片节点两类代表性目录项；节点类型、模型和参数必须经过目录/schema/ModelRegistry 校验，禁止模型自由编造类型或传入任意本地路径。
- 模型只选择 `viewport_center/right_of_node` 布局意图，renderer 根据项目内容计算像素位置；写操作必须携带显式 projectId 并校验 canvas scope revision。
- 添加、连接与撤销复用 renderer 应用动作并立即持久化；undoRef 严格后进先出且检查当前历史长度，避免撤销用户在其后做出的其它修改。
- 同一模型响应包含多个画布写工具时，Runner 把前一步返回的 resulting scope revision 传给后一步，既防止自冲突也不放松外部 revision 校验。

### D-019 诊断外发与最小评测门槛

- 受限日志证据虽然已脱敏，发送到当前助手 Provider 仍按 C2/open-world 处理；每次必须展示确切字段、目标、用途并使用 R2 单次审批，C3 继续由网关硬阻断。
- 第五阶段评测采用可扩展的 case/capture/check/summary 结构，统一记录工具、参数键、禁止动作、日志成对、敏感探针、成功率、平均/p95 延迟和 token；不建设平行 Trace 平台。
- 确定性用例必须全过，真实 Provider 需要固定 Profile 重复运行并记录随机性；未完成真实基线前第五阶段保持待验证。

### D-020 生成模型描述与用户偏好使用单一权威源

- 每个供应商模型仍保留独立 `.model.ts` 文件和原有参数、端点、价格、标签与请求构建，只新增 `meta.canonicalModelId`；同一底层模型跨供应商复用同一个通用标识。
- 图片、视频、音频模型的定性描述只在 `src/core/modelCatalog/generationModelDescriptions.ts` 维护，供应商模型文件和供应商 i18n 禁止重复声明描述；描述只表达擅长方向或相对定位，不承担固有能力声明。
- 模型选择严格遵循“用户当前明确要求 > 持久化模型偏好 > 通用模型描述”，tags、输入约束和参数 schema 始终是硬能力边界，描述不得推导未声明能力。
- 模型偏好由 Electron 主进程持久化为结构化 JSON，设置页、手工编辑和 Agent 受控工具共享同一文件；Agent 修改属于 R2/C1，必须经过工具网关审批。

### D-021 用户指令与助手自动记忆分层

- 本决定替代 D-020 中“结构化模型偏好 JSON”的实现方式：用户主动维护的偏好和工作习惯统一保存为自然语言 `user-instructions.md`，设置页与 Agent 受控工具共享同一主进程权威文件。
- 用户指令属于最多 4000 字的 P3，不是系统规则或助手推断的长期记忆；具体优先级和脱敏边界由 D-022 补充。
- Agent 只有在用户明确要求长期保存时才能经 R2/C1 工具审批更新用户指令；更新前读取现有内容并保留无关条目，禁止自动写入临时要求、敏感内容、日志、文件或模型推断。
- 真正的助手自动记忆留到 6.5：与 run state、thread history、用户指令分表/分入口，提供候选提取、来源、scope、过期、冲突、确认、删除和隐私控制；检索只按当前任务渐进披露相关条目。

### D-022 用户指令在硬约束内保持高优先级

- 执行优先级固定为“安全与真实能力硬约束 > 用户当前明确要求 > 持久化用户指令 > 通用模型描述与系统默认倾向”。产品默认、推荐策略或通用描述与用户指令不同时，以用户指令为准。
- 只有用户指令明确违反安全、权限、审批、工具协议，要求不存在的能力，或与权威 schema/运行状态冲突时才能拒绝或偏离，并必须向用户说明具体硬约束；P3 的不可信边界只防止提权，不表示低优先级。
- 开发期彻底抛弃旧 `model-preferences.json`：运行时不读取、不迁移也不主动删除，唯一权威源为 `user-instructions.md`。
- P3 用户指令只自动脱敏 API Key、token、cookie、授权头、客户端密钥、私钥、密码等秘密信息，普通路径、带查询参数的网址和其他正常内容保持原样；P8 日志、文件和工具 observations 仍执行更严格的最小化与脱敏。

### D-023 生成路由和能力发现使用本地权威策略

- 明确媒体生成表达优先走本地确定性规则；“照片、插画、海报、头像、壁纸、封面、短片、配音”等与图片/视频/音频同等处理，避免因 router 模型结构输出波动而丢失核心生成链路。
- router 模型只返回 intent、complexity 和 reason；path 与 toolDomains 由本地 `routePolicy` 映射，模型不能自定义工具域。分类失败记录不含目标原文的稳定错误码，再进入受控能力发现。
- 能力目录 category 使用固定枚举，查询按原始词、多词和媒体/生成语义相关性排序；只有权威 Registry 中存在的发现结果才能在下一轮进入 active tools，仍受上下文可用性、最多 8 工具、网关权限和审批限制。
- 生成路由同时携带 navigation 域：可见生成命令尚未注册时先切换到生成工作区并刷新上下文。模型目录 query 只筛模型名称/标识，内容、题材和风格保留在最终 prompt。

## 可调参数

- turns、token、offload 和 router 置信阈值是 v1 初值，允许 5.4/6.2 基于真实评测调优，但不得绕过安全硬限制。
- 并行只读工具在 3.2 完成串行基线和并发测试后才可开放。
