export interface VolcengineRealtimeAsrOptions {
  enableItn?: boolean
  enableDdc?: boolean
  showUtterances?: boolean
  /**
   * 热词直传，写入 `request.corpus.context`，优先级高于控制台热词表。
   * 官方写双向流式上限 100 tokens，超限行为官方未说明，SDK 不截断。
   */
  hotwords?: readonly string[]
}

export interface VolcengineRealtimeModuleOptions {
  /** 默认使用 SeedASR 2.0 双向流式优化端点。 */
  webSocketUrl?: string
  /** 等待 full request 服务端响应的上限，默认 15 秒。 */
  openTimeoutMs?: number
  /** `X-Api-Request-Id` 必须为 UUID；测试或强随机宿主可以注入生成器。 */
  requestIdFactory?(requestId: string): string
}
