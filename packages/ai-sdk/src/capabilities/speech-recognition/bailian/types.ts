export interface BailianAsrOptions {
  format?: string
  sampleRateHz?: number
  enableItn?: boolean
  context?: string
  vocabularyId?: string
  diarizationEnabled?: boolean
  speakerCount?: number
  channelId?: number
  specialWordFilter?: string
  /** Qwen-Audio 3.1 保留方言表达。 */
  keepDialect?: boolean
  /** Qwen-Audio 3.x 即时热词：权重 1–5 或 50（超级热词最多 50 个）。 */
  vocabulary?: Readonly<Record<string, number>>
}

export interface BailianAsrModuleOptions {
  /** DashScope `/api/v1` 根路径；工作空间端点可由消费方完整注入。 */
  apiBaseUrl?: string
  /** DashScope `/compatible-mode/v1` 根路径。 */
  compatibleBaseUrl?: string
  /** 临时 OSS 凭证固定服务根路径；默认不跟随工作空间 API 端点。 */
  uploadBaseUrl?: string
  pollIntervalMs?: number
  maxPollingMs?: number
}
