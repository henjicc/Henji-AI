/**
 * 单轮活动工具的预算，**唯一来源**。
 *
 * 运行时的激活逻辑、事件契约（`ContextUpdated.activeToolNames`）和保存点契约
 * （`agentTurnSnapshotDraftSchema.tools`）必须共用这一份。此前它们各写各的：运行时是
 * 常量 8，两个契约各自硬编码 12。把运行时上限提到 16 之后，两个契约当场把每一次运行都
 * 挡在模型请求之前——错误还只显示成一句 "Invalid input"。
 *
 * 数量只是兜底，真正的约束是字节预算；两者都放这里，就不会再出现改了一处漏了两处。
 */
export const AGENT_ACTIVE_TOOL_LIMIT = 16
export const AGENT_TOOL_SCHEMA_BUDGET_BYTES = 48 * 1024
