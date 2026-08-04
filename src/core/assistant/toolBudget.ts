/**
 * 单轮活动工具的预算，**唯一来源**。
 *
 * 运行时的激活逻辑、事件契约（`ContextUpdated.activeToolNames`）和保存点契约
 * （`agentTurnSnapshotDraftSchema.tools`）必须共用这一份。此前它们各写各的：运行时是
 * 常量 8，两个契约各自硬编码 12。把运行时上限提到 16 之后，两个契约当场把每一次运行都
 * 挡在模型请求之前——错误还只显示成一句 "Invalid input"。
 *
 * 数量只是兜底，真正的约束是字节预算；两者都放这里，就不会再出现改了一处漏了两处。
 *
 * 16/48KB 在实测里明显偏紧：一个三维任务的候选能力有 26 个以上，加上常驻工具，模型刚用过
 * 的写入工具下一轮就被轮换挤掉，报 TOOL_NOT_ACTIVE 后只能等下一轮——而任务图往往先结算，
 * 下一轮永远不来。放宽到 32/96KB：96KB schema 约合 2.4 万 token，对 12.8 万上下文是可接受的
 * 常驻开销，换来的是"正在用的工具不会凭空消失"。
 */
export const AGENT_ACTIVE_TOOL_LIMIT = 32
export const AGENT_TOOL_SCHEMA_BUDGET_BYTES = 96 * 1024
/** 活动工具业务描述的独立构建门禁；通用网关语义只在公共契约层出现一次。 */
export const AGENT_TOOL_DESCRIPTION_BUDGET_BYTES = 32 * 1024

/** 一个依赖前沿 Facet 最多持有的稳定工具租约。 */
export const AGENT_FACET_LEASE_TOOL_LIMIT = 5
/** 一轮发现最多覆盖三个当前可运行的 Facet。 */
export const AGENT_LEASE_FRONTIER_FACET_LIMIT = 3
/** 7 个核心工具之外，发现结果最多承诺 15 个下一轮真实可用的租约工具。 */
export const AGENT_DISCOVERY_LEASE_TOOL_LIMIT =
  AGENT_FACET_LEASE_TOOL_LIMIT * AGENT_LEASE_FRONTIER_FACET_LIMIT
