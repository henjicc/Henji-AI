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

/**
 * 一次能力发现最多回带多少个待激活工具名。
 * 发现结果的裁剪与 addedToolNames 的 schema 上限必须是同一个数。
 * 必须 >= AGENT_ACTIVE_TOOL_LIMIT，否则永远填不满工具位（budget-consistency 用例守这条）。
 */
export const AGENT_DISCOVERY_ADDED_TOOL_LIMIT = 40
