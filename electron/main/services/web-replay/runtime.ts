import fs from 'node:fs/promises'
import path from 'node:path'
import { net, shell } from 'electron'
import type { WebRecordingManifest } from '../../../../src/core/webReplay/schema'
import type { WebRecordingBackupOptions, WebRecordingSummary, WebReplayReadRequest, WebReplayReadResult, WebReplayRenderProgress, WebReplayRenderRequest, WebReplayRenderResult, WebReplayServerState } from '../../../../src/platform/contracts/webReplay'
import { createMainLogger } from '../logging'
import { BACKUP_VIDEO_FILE, WebRecordingBackupVideo, BACKUP_AUDIO_DIRECTORY, mixWebRecordingBackupAudio } from './backupVideo'
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
let state: Omit<WebReplayServerState, 'apps'> = { enabled: false, listening: false, port: WEB_REPLAY_PORT }
const listeners = new Set<(state: WebReplayServerState) => void>()

function snapshot(): WebReplayServerState { return { ...state, apps: server?.apps() ?? [] } }

/** Starts the local probe hub. A busy port is reported in the state, not thrown at startup. */
export async function startWebReplayService(port = Number(process.env.HENJI_WEB_REPLAY_PORT) || WEB_REPLAY_PORT): Promise<void> {
  if (server) return
  server = new WebReplayServer(fetchExternal, async session => {
    if (!session.backupOptions) return null
    const started = await WebRecordingBackupVideo.start(session.store.directory, session.id, session.info.app.name, session.info.env.viewport, session.backupOptions)
    return 'backup' in started ? started.backup : started
  })
  server.on('changed', () => { const value = snapshot(); listeners.forEach(fn => fn(value)) })
  try {
    await server.start(port)
    state = { enabled: true, listening: true, port }
  } catch (error) {
    state = { enabled: true, listening: false, port, error: `本机端口 ${port} 被占用，网页应用无法连接：${String((error as Error)?.message ?? error)}` }
    logger.warn('网页录制服务未能启动', { event: 'web_replay.server.failed', context: { port }, error: String(error) })
  }
}

export async function stopWebReplayService(): Promise<void> {
  const current = server
  server = null
  state = { enabled: false, listening: false, port: state.port }
  await current?.stop()
}

/** The experimental setting lives in the renderer; it turns the local hub on or off without a restart. */
export async function setWebReplayEnabled(enabled: boolean): Promise<WebReplayServerState> {
  if (enabled && !server) await startWebReplayService()
  else if (!enabled && server) await stopWebReplayService()
  const value = snapshot()
  listeners.forEach(fn => fn(value))
  return value
}

export function webReplayState(): WebReplayServerState { return snapshot() }
export function onWebReplayStateChanged(listener: (state: WebReplayServerState) => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }

function requireServer(): WebReplayServer {
  if (!state.enabled) throw new Error('网页应用录制是实验性功能，尚未开启；请先在 设置 → 通用 → 实验性功能 中打开')
  if (!server || !state.listening) throw new Error(state.error ?? '网页录制服务尚未启动')
  return server
}

export function startWebRecording(connectionId: string, backup: WebRecordingBackupOptions | null): Promise<WebRecordingManifest> { return requireServer().startRecording(connectionId, backup) }
export function stopWebRecording(recordingId: string): Promise<WebRecordingManifest> { return requireServer().stopRecording(recordingId) }

const TRASH = '.trash'
const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The newest replay video inside a recording directory (names sort by render time). */
async function latestVideo(directory: string): Promise<string | null> {
  const newest = (await fs.readdir(directory).catch(() => [] as string[])).filter(name => /^replay-.*\.mp4$/.test(name)).sort().at(-1)
  return newest ? path.join(directory, newest) : null
}

/** Every recording on disk, newest first. Unreadable directories are skipped and logged. */
export async function listWebRecordings(): Promise<WebRecordingSummary[]> {
  const root = webRecordingsRoot()
  const names = (await fs.readdir(root).catch(() => [] as string[])).filter(name => UUID_NAME.test(name))
  const manifests = await Promise.all(names.map(async name => {
    const directory = path.join(root, name)
    try {
      const backup = path.join(directory, BACKUP_VIDEO_FILE)
      return { ...await new WebRecordingStore(directory).readManifest(), video: await latestVideo(directory), backupVideo: await fs.access(backup).then(() => backup, () => null) }
    } catch (error) {
      logger.warn('网页录制无法读取', { event: 'web_replay.recording.unreadable', context: { name }, error: String(error) })
      return null
    }
  }))
  return manifests.filter((m): m is WebRecordingSummary => m !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Windows refuses to move a folder while any file in it is open (a video still closing in the preview,
 * the indexer, antivirus); those locks clear within moments, so the move is retried briefly.
 */
async function moveDirectory(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(from, to); return } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') || attempt >= 15) {
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') throw new Error('这段录制的文件正被其他程序占用，请关闭正在播放或打开它的程序后再删除')
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
}

/** Deleting moves the directory to a trash folder beside it, so the operation can be undone. */
export async function removeWebRecording(recordingId: string): Promise<void> {
  if ((server?.apps() ?? []).some(app => app.recordingId === recordingId)) throw new Error('这段网页录制还在进行，请先停止')
  if (rendering.has(recordingId)) throw new Error('这段网页录制正在重演，请等待完成')
  const trash = path.join(webRecordingsRoot(), TRASH)
  await fs.mkdir(trash, { recursive: true })
  await fs.rm(path.join(trash, recordingId), { recursive: true, force: true })
  await moveDirectory(webRecordingDirectory(recordingId), path.join(trash, recordingId))
  logger.info('网页录制已移到回收区', { event: 'web_replay.recording.removed', context: { recordingId } })
}

export async function restoreWebRecording(recordingId: string): Promise<void> {
  const target = webRecordingDirectory(recordingId) // also validates the id
  await moveDirectory(path.join(webRecordingsRoot(), TRASH, recordingId), target)
  logger.info('网页录制已恢复', { event: 'web_replay.recording.restored', context: { recordingId } })
}

/** Renaming only rewrites the manifest's title; the folder keeps its id. */
export async function renameWebRecordings(items: Array<{ recordingId: string; title: string | null }>): Promise<void> {
  for (const { recordingId, title } of items) {
    const store = WebRecordingStore.forId(recordingId)
    const { title: _old, ...manifest } = await store.readManifest()
    await store.writeManifest({ ...manifest, ...(title ? { title } : {}) })
  }
  logger.info('网页录制已重命名', { event: 'web_replay.recording.renamed', context: { count: items.length } })
}

export function webRecordingTitle(manifest: WebRecordingManifest): string {
  return manifest.title ?? `${manifest.app.name} ${new Date(manifest.createdAt).toLocaleString('zh-CN', { hour12: false })}`
}

/** Names never overwrite an existing file: a clash gets " (2)", " (3)"… */
async function freeName(directory: string, base: string): Promise<string> {
  const safe = base.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 120) || '网页录制'
  for (let index = 1; ; index++) {
    const candidate = path.join(directory, `${safe}${index > 1 ? ` (${index})` : ''}.mp4`)
    if (!await fs.access(candidate).then(() => true, () => false)) return candidate
  }
}

export async function exportWebRecordingVideos(recordingIds: string[], directory: string): Promise<{ files: string[]; skipped: number }> {
  if (!(await fs.stat(directory).catch(() => null))?.isDirectory()) throw new Error('导出位置不是文件夹')
  const recordings = new Map((await listWebRecordings()).map(item => [item.id, item]))
  const files: string[] = []
  let skipped = 0
  for (const id of recordingIds) {
    const recording = recordings.get(id)
    const sources: Array<[string | null, string]> = recording ? [[recording.backupVideo, '备份录屏'], [recording.video, '重演']] : []
    const present = sources.filter((entry): entry is [string, string] => entry[0] !== null)
    if (!present.length) { skipped++; continue }
    for (const [file, label] of present) {
      const target = await freeName(directory, present.length > 1 ? `${webRecordingTitle(recording!)} ${label}` : webRecordingTitle(recording!))
      await fs.copyFile(file, target)
      files.push(target)
    }
  }
  logger.info('网页录制视频已导出', { event: 'web_replay.recording.exported', context: { files: files.length, skipped } })
  return { files, skipped }
}

export async function backupAudioDirectory(recordingId: string): Promise<string> {
  const directory = path.join(webRecordingDirectory(recordingId), BACKUP_AUDIO_DIRECTORY)
  await fs.mkdir(directory, { recursive: true })
  return directory
}

/** The page stops its sound after the recording ended elsewhere; the picture may still be saving. */
export function mixWebRecordingAudio(recordingId: string): Promise<boolean> { return mixWebRecordingBackupAudio(webRecordingDirectory(recordingId), 60_000) }

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
export async function renderWebRecording(request: WebReplayRenderRequest, signal?: AbortSignal, onProgress?: (progress: WebReplayRenderProgress) => void): Promise<WebReplayRenderResult> {
  if (rendering.has(request.recordingId)) throw new Error('这段网页录制正在重演，请等待完成')
  rendering.add(request.recordingId)
  try {
    const output = request.output ?? path.join(webRecordingDirectory(request.recordingId), `replay-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`)
    await fs.mkdir(path.dirname(output), { recursive: true })
    logger.info('开始网页重演', { event: 'web_replay.replay.start', context: { recordingId: request.recordingId, output } })
    return await WebRecordingPlayer.open(request.recordingId).render({ output, fps: request.fps, signal, onFrame: onProgress ? (progress, frame) => onProgress({ recordingId: request.recordingId, progress, frame }) : undefined })
  } finally { rendering.delete(request.recordingId) }
}
