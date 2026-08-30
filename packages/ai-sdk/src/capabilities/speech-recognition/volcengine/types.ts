export interface VolcengineAsrOptions {
  /** 火山请求 `audio.format`；无法从 URL、文件名或 MIME 推断时必须显式提供。 */
  format?: string
  enableItn?: boolean
  enableDdc?: boolean
  showUtterances?: boolean
}

export interface VolcengineAsrModuleOptions {
  /** 默认 `https://openspeech.bytedance.com/api/v3/auc/bigmodel`。 */
  apiBaseUrl?: string
  pollIntervalMs?: number
  maxPollingMs?: number
  /** 火山任务 ID 必须为 UUID；测试或强随机宿主可以注入生成器。 */
  requestIdFactory?(requestId: string): string
}
