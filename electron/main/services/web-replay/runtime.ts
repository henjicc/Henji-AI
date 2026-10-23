import fs from 'node:fs/promises'
import path from 'node:path'
import { net, shell } from 'electron'
import type { WebRecordingManifest } from '../../../../src/core/webReplay/schema'
import type { WebReplayReadRequest, WebReplayReadResult, WebReplayRenderRequest, WebReplayRenderResult, WebReplayServerState } from '../../../../src/platform/contracts/webReplay'
import { createMainLogger } from '../logging'
import { WebRecordingPlayer } from './player/player'
import { WEB_REPLAY_PORT, WebReplayServer } from './server'
import { webRecordingDirectory, webRecordingsRoot, WebRecordingStore } from './store'

const logger = createMainLogger('main.web_replay')
const MAX_EXTERNAL_BYTES = 32 * 1024 * 1024

async function fetchExternal(url: string, userAgent: string): Promise<{ status: number; contentType: string; bytes: Uint8Array }> {
  // Same request the WebView made: no referrer (the app uses referrerPolicy="no-referrer"), same UA.
  const response = await net.fetch(url, { headers: { 'user-agent': userAgent }, referrerPolicy: 'no-referrer', bypassCustomProtocolHandlers: true })
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_EXTERNAL_BYTES) throw new Error('外部资源过大')
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', bytes }
}

let server: WebReplayServer | null = null
let state: Omit<WebReplayServerState, 'apps'> = { listening: false, port: WEB_REPLAY_PORT }
const listeners = new Set<(state: WebReplayServerState) => void>()

function snapshot(): WebReplayServerState { return { ...state, apps: server?.apps() ?? [] } }

/** Starts the local probe hub. A busy port is reported in the state, not thrown at startup. */
export async function startWebReplayService(port = Number(process.env.HENJI_WEB_REPLAY_PORT) || WEB_REPLAY_PORT): Promise<void> {
  if (server) return
  server = new WebReplayServer(fetchExternal)
  server.on('changed', () => { const value = snapshot(); listeners.forEach(fn => fn(value)) })
  try {
    await server.start(port)
    state = { listening: true, port }
  } catch (error) {
    state = { listening: false, port, error: `本机端口 ${port} 被占用，网页应用无法连接：${String((error as Error)?.message ?? error)}` }
    logger.warn('网页录制服务未能启动', { event: 'web_replay.server.failed', context: { port }, error: String(error) })
  }
}

export async function stopWebReplayService(): Promise<void> { await server?.stop(); server = null }

export function webReplayState(): WebReplayServerState { return snapshot() }
export function onWebReplayStateChanged(listener: (state: WebReplayServerState) => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }

function requireServer(): WebReplayServer {
  if (!server || !state.listening) throw new Error(state.error ?? '网页录制服务尚未启动')
  return server
}

export function startWebRecording(connectionId: string): Promise<WebRecordingManifest> { return requireServer().startRecording(connectionId) }
export function stopWebRecording(recordingId: string): Promise<WebRecordingManifest> { return requireServer().stopRecording(recordingId) }

/** Every recording on disk, newest first. Unreadable directories are skipped and logged. */
export async function listWebRecordings(): Promise<WebRecordingManifest[]> {
  const root = webRecordingsRoot()
  const names = await fs.readdir(root).catch(() => [] as string[])
  const manifests = await Promise.all(names.map(async name => {
    try { return await new WebRecordingStore(path.join(root, name)).readManifest() } catch (error) {
      logger.warn('网页录制无法读取', { event: 'web_replay.recording.unreadable', context: { name }, error: String(error) })
      return null
    }
  }))
  return manifests.filter((m): m is WebRecordingManifest => m !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getWebRecording(recordingId: string): Promise<WebRecordingManifest> { return WebRecordingStore.forId(recordingId).readManifest() }

/** Full, unredacted track pages (the user chose full assistant visibility); blob bodies stay as references. */
export async function readWebRecording(request: WebReplayReadRequest): Promise<WebReplayReadResult> {
  const store = WebRecordingStore.forId(request.recordingId)
  const entries: unknown[] = request.track === 'data' ? await store.readData().then(d => [...d.calls, ...d.external.map(e => ({ kind: 'external', ...e }))]) : await store.readBehavior()
  const page = entries.slice(request.offset, request.offset + request.limit)
  return { entries: page, total: entries.length, nextOffset: request.offset + page.length < entries.length ? request.offset + page.length : null }
}

export async function revealWebRecording(recordingId: string, file?: string): Promise<void> {
  const directory = webRecordingDirectory(recordingId)
  const target = file ? path.resolve(file) : directory
  if (target !== directory && !target.startsWith(directory + path.sep)) throw new Error('只能打开这段录制自己的文件')
  if (file) shell.showItemInFolder(target)
  else { const error = await shell.openPath(target); if (error) throw new Error(error) }
}

const rendering = new Set<string>()
export async function renderWebRecording(request: WebReplayRenderRequest, signal?: AbortSignal): Promise<WebReplayRenderResult> {
  if (rendering.has(request.recordingId)) throw new Error('这段网页录制正在重演，请等待完成')
  rendering.add(request.recordingId)
  try {
    const output = request.output ?? path.join(webRecordingDirectory(request.recordingId), `replay-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`)
    await fs.mkdir(path.dirname(output), { recursive: true })
    logger.info('开始网页重演', { event: 'web_replay.replay.start', context: { recordingId: request.recordingId, output } })
    return await WebRecordingPlayer.open(request.recordingId).render({ output, fps: request.fps, signal })
  } finally { rendering.delete(request.recordingId) }
}
