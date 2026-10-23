import { PROBE_WS_PATH, type HenjiMessage, type ProbeMessage } from '../protocol'

/**
 * Keeps one WebSocket to Henji. While idle it retries quietly with backoff; outgoing messages are
 * queued until the socket is open, so recording keeps its order across a brief disconnect.
 */
export class HenjiConnection {
  private socket: WebSocket | null = null
  private queue: string[] = []
  private retryMs = 2000
  private timer: ReturnType<typeof setTimeout> | undefined
  onOpen: () => void = () => {}
  onMessage: (message: HenjiMessage) => void = () => {}

  constructor(private readonly port: number, private readonly NativeWebSocket: typeof WebSocket) {}

  connect(): void {
    if (this.socket) return
    let socket: WebSocket
    try { socket = new this.NativeWebSocket(`ws://127.0.0.1:${this.port}${PROBE_WS_PATH}`) } catch { this.schedule(); return }
    this.socket = socket
    socket.onopen = () => {
      this.retryMs = 2000
      this.onOpen()
      for (const data of this.queue.splice(0)) socket.send(data)
    }
    socket.onmessage = event => {
      if (typeof event.data !== 'string') return
      // eslint-disable-next-line no-console -- the probe runs inside another app and has no Henji logger
      try { this.onMessage(JSON.parse(event.data) as HenjiMessage) } catch (error) { console.warn('[henji-web-replay] 无法处理痕迹消息', error) }
    }
    socket.onclose = () => { this.socket = null; this.schedule() }
    socket.onerror = () => { /* onclose follows */ }
  }

  send(message: ProbeMessage): void {
    const data = JSON.stringify(message)
    if (this.socket?.readyState === this.NativeWebSocket.OPEN) this.socket.send(data)
    else this.queue.push(data)
  }

  /** Sends only on an open socket; used by onOpen so hello precedes the queued backlog. */
  sendNow(message: ProbeMessage): void {
    if (this.socket?.readyState === this.NativeWebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  get open(): boolean { return this.socket?.readyState === this.NativeWebSocket.OPEN }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; this.connect() }, this.retryMs)
    this.retryMs = Math.min(15000, Math.round(this.retryMs * 1.5))
  }
}
