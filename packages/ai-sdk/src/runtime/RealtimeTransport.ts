export type RealtimePayload = string | Uint8Array

export interface RealtimeConnectOptions {
  protocols?: string | readonly string[]
  headers?: Readonly<Record<string, string>>
  signal?: AbortSignal
}

export interface RealtimeMessage {
  data: RealtimePayload
}

/**
 * 宿主提供的单条实时连接。SDK 只依赖消息、发送和关闭三项最小语义，
 * 不直接依赖浏览器 WebSocket、Node ws 或 Tauri 插件的具体对象。
 */
export interface RealtimeConnection {
  readonly messages: AsyncIterable<RealtimeMessage>
  send(data: RealtimePayload): Promise<void> | void
  close(code?: number, reason?: string): Promise<void> | void
}

/** HTTP 之外的实时双向传输入口，由宿主按自己的网络权限实现。 */
export interface RealtimeTransport {
  connect(url: string, options?: RealtimeConnectOptions): Promise<RealtimeConnection>
}
