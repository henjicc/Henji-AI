import crypto from 'node:crypto'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { WebSocketServer, type WebSocket } from 'ws'
import type { WebRecordingBackupOptions } from '../../../../src/platform/contracts/webReplay'
import { probeMessageSchema, type AppInfoValue, type WebRecordingEnvironment, type WebRecordingManifest } from '../../../../src/core/webReplay/schema'
import { createMainLogger } from '../logging'
import { WebRecordingSession, type FetchExternal, type StartBackupVideo } from './session'

const logger = createMainLogger('main.web_replay.server')
export const WEB_REPLAY_PORT = 47831
const PATH = '/web-replay'
const PING_SAMPLES = 8

export interface ConnectedWebApp {
  connectionId: string
  app: AppInfoValue
  host: WebRecordingManifest['host']
  env: WebRecordingEnvironment
  probeVersion: string
  recordingId: string | null
  /** Wall-clock ms when the reloaded page started recording; drives the live timer. */
  recordingStartedAt: number | null
}

interface Connection { id: string; socket: WebSocket; app?: ConnectedWebApp; session?: WebRecordingSession }

/**
 * Local hub for probes. Only listens on 127.0.0.1; any page may connect (the user chose maximum
 * openness for recording). Henji is the hub, so several apps never compete for a port.
 */
export class WebReplayServer extends EventEmitter {
  private http: http.Server | null = null
  private wss: WebSocketServer | null = null
  private connections = new Map<string, Connection>()
  private sessions = new Map<string, WebRecordingSession>()

  constructor(private readonly fetchExternal: FetchExternal, private readonly startBackup?: StartBackupVideo) { super() }

  async start(port = WEB_REPLAY_PORT): Promise<void> {
    if (this.http) return
    const server = http.createServer((_req, res) => { res.writeHead(404); res.end() })
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 })
    server.on('upgrade', (request, socket, head) => {
      if (new URL(request.url ?? '/', 'http://127.0.0.1').pathname !== PATH) { socket.destroy(); return }
      wss.handleUpgrade(request, socket, head, ws => this.accept(ws))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    this.http = server
    this.wss = wss
    logger.info('网页录制服务已启动', { event: 'web_replay.server.started', context: { port } })
  }

  async stop(): Promise<void> {
    for (const c of this.connections.values()) c.socket.close()
    this.wss?.close()
    await new Promise<void>(resolve => (this.http ? this.http.close(() => resolve()) : resolve()))
    this.http = null
    this.wss = null
  }

  apps(): ConnectedWebApp[] {
    return [...this.connections.values()].flatMap(c => (c.app ? [{ ...c.app, recordingId: c.session?.id ?? null, recordingStartedAt: c.session?.startedAt ?? null }] : []))
  }

  /** Starts recording the app on this connection; the page reloads and records from its first module. */
  async startRecording(connectionId: string, backup: WebRecordingBackupOptions | null = null): Promise<WebRecordingManifest> {
    const connection = this.connections.get(connectionId)
    if (!connection?.app) throw new Error('这个网页应用已断开，请确认它仍在运行')
    if (connection.session) throw new Error('这个网页应用正在录制')
    const session = new WebRecordingSession({ app: connection.app.app, host: connection.app.host, env: connection.app.env, probe: { version: connection.app.probeVersion, protocol: 1 } }, this.fetchExternal, this.startBackup, backup)
    await session.prepare()
    this.sessions.set(session.id, session)
    connection.session = session
    this.send(connection, { type: 'start', session: session.id })
    this.changed()
    return session.info
  }

  async stopRecording(recordingId: string): Promise<WebRecordingManifest> {
    const session = this.sessions.get(recordingId)
    if (!session) throw new Error('没有找到这段正在进行的网页录制')
    const connection = [...this.connections.values()].find(c => c.session === session)
    try {
      return await session.stop(message => (connection ? this.send(connection, message) : false))
    } finally {
      this.sessions.delete(recordingId)
      for (const c of this.connections.values()) if (c.session === session) c.session = undefined
      this.changed()
    }
  }

  recording(recordingId: string): WebRecordingSession | undefined { return this.sessions.get(recordingId) }

  private accept(socket: WebSocket): void {
    const connection: Connection = { id: crypto.randomUUID(), socket }
    this.connections.set(connection.id, connection)
    this.send(connection, { type: 'welcome', connection: connection.id })
    socket.on('message', data => this.receive(connection, data.toString()))
    socket.on('close', () => {
      this.connections.delete(connection.id)
      connection.session?.disconnected()
      if (connection.app) logger.info('网页应用已断开', { event: 'web_replay.app.disconnected', context: { app: connection.app.app.name } })
      this.changed()
    })
    socket.on('error', error => logger.warn('网页应用连接出错', { event: 'web_replay.socket.error', error: String(error) }))
  }

  private receive(connection: Connection, raw: string): void {
    let message
    try { message = probeMessageSchema.parse(JSON.parse(raw)) } catch (error) {
      logger.warn('收到无法识别的探针消息', { event: 'web_replay.message.invalid', error: String(error).slice(0, 2000) })
      return
    }
    if (message.type === 'hello') {
      connection.app = { connectionId: connection.id, app: message.app, host: message.host, env: message.env, probeVersion: message.probeVersion, recordingId: null, recordingStartedAt: null }
      const resumed = message.session ? this.sessions.get(message.session) : undefined
      if (resumed) {
        connection.session = resumed
        // Clock samples belong to the reloaded page, whose performance.now() starts the recording.
        for (let i = 0; i < PING_SAMPLES; i += 1) setTimeout(() => { const ping = resumed.ping(); if (ping) this.send(connection, ping) }, i * 60)
      }
      logger.info('网页应用已连接', { event: 'web_replay.app.connected', context: { app: message.app.name, host: message.host, recording: Boolean(resumed) } })
      this.changed()
      return
    }
    if ('session' in message && message.session && connection.session?.id !== message.session) {
      const session = this.sessions.get(message.session)
      if (session) connection.session = session
      else return
    }
    const wasStarting = connection.session?.state === 'starting'
    connection.session?.handle(message)
    if (wasStarting && connection.session?.state === 'recording') this.changed()
  }

  private send(connection: Connection, message: object): boolean {
    if (connection.socket.readyState !== connection.socket.OPEN) return false
    connection.socket.send(JSON.stringify(message))
    return true
  }

  private changed(): void { this.emit('changed', this.apps()) }
}
