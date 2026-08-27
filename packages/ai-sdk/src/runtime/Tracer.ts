/**
 * 一次追踪 span 的最小上下文：给定名称，返回一个用于结束该 span 的句柄。
 *
 * 这是刻意最小化的公共契约：生成、LLM 流式与 LLM 模型步只报告通用 span 生命周期，
 * 不携带痕迹AI 助手专属的 thread/turn/context compaction 等结构。
 */
export interface TraceSpan {
  /** 结束该 span。`error` 为可选的失败原因；不传表示正常结束。 */
  end(error?: unknown): void
}

/**
 * `Tracer` 是 SDK 内部可选的调用链追踪出口。
 *
 * 为什么由宿主提供：追踪数据最终要汇入哪个系统是宿主决定的。痕迹AI 的助手 trace
 * 按重要记录 014 明确保留在应用侧；其他宿主可能接入 APM，也可能完全不追踪。
 * SDK 内部不对最终去向做任何假设。
 */
export interface Tracer {
  /** 开始一个 span，返回用于结束它的句柄。 */
  startSpan(name: string, attributes?: Record<string, unknown>): TraceSpan
}

/**
 * 缺省追踪实现：不追踪任何东西，`end()` 是空操作。
 * 与 `noopLogger` 同理——`RuntimeContext.tracer` 缺省用这个实现即可安全运行。
 */
export const noopTracer: Tracer = {
  startSpan: () => ({ end: () => undefined }),
}
