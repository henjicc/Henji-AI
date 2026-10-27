import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { net, shell } from 'electron'
import type { WebRecordingManifest } from '../../../../src/core/webReplay/schema'
import type { WebRecordingBackupOptions, WebRecordingDestination, WebRecordingImportRequest, WebRecordingSummary, WebReplayReadRequest, WebReplayReadResult, WebReplayRenderProgress, WebReplayRenderRequest, WebReplayRenderResult, WebReplayServerState } from '../../../../src/platform/contracts/webReplay'
import { createMainLogger } from '../logging'
import { BACKUP_VIDEO_FILE, WebRecordingBackupVideo, BACKUP_AUDIO_DIRECTORY, mixWebRecordingBackupAudio } from './backupVideo'
import { WebRecordingPlayer, type ReplayOptions } from './player/player'
import { ReplayRenderQueue } from './renderQueue'
import { WEB_REPLAY_PORT, WebReplayServer } from './server'
import { webRecordingsRoot, WebRecordingStore } from './store'
import { forgetActiveWebRecording, listWebRecordingLocations, rememberActiveWebRecording, resolveWebRecordingDirectory, resolveWebRecordingLocation, webRecordingIdTaken } from './locations'
import { getDocumentService } from '../documents/runtime'
import { stripHenjiExtension } from '../../../../src/core/fileExtensions'
import { copyDirectoryContentsNoOverwrite } from '../fs/no-overwrite'
import { moveWebRecordingDirectory } from './moveDirectory'
import { forgetWebRecordingTrashMark, markWebRecordingTrashed, purgeExpiredWebRecordingTrash } from './trash'
import { readTextTrack, searchTextTrack, TEXT_TRACK_FILE } from './textTrack'
import { readBoxTrack } from './boxTrackReader'
import { newestReplayName, REPLAY_CLEAN_SUFFIX } from '../../../../src/core/webReplay/replayVideos'
import { checkDirectorAgainstRecording, parseWebReplayDirector, WebReplayDirectorError, type WebReplayDirector } from '../../../../src/core/webReplay/director'
import type { WebRecordingTakeInfo } from '../../../../src/platform/contracts/webReplay'
import { listWebReplayTakes, readWebReplayTake, readWebReplayTakeBehavior, renderWebReplayTake, TAKE_FILES, type WebReplayTakeSummary } from './takes'

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

/** File names cannot carry these characters; the title keeps the user's words otherwise. */
export function webRecordingFileName(title: string): string {
  // eslint-disable-next-line no-control-regex -- 文件名里不能有控制字符
  return title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/[. ]+$/, '').trim().slice(0, 120) || '网页录制'
}

export function defaultProjectRecordingTitle(app: string, at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${app} ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`
}

/**
 * With a project destination the recording is written straight into `<项目>/素材/录屏/<名称>.hjweb` and registered as a
 * document; without one it goes to the app-data root as before.
 */
export async function startWebRecording(connectionId: string, backup: WebRecordingBackupOptions | null, destination: WebRecordingDestination | null = null): Promise<WebRecordingManifest> {
  const hub = requireServer()
  if (!destination) return hub.startRecording(connectionId, backup)
  const app = hub.connectedApp(connectionId)
  const id = crypto.randomUUID()
  const documents = getDocumentService()
  const created = await documents.createFolderDocumentLocation({ kind: 'web_recording', container: { kind: 'project', projectId: destination.projectId }, name: webRecordingFileName(destination.name?.trim() || defaultProjectRecordingTitle(app.app.name, new Date())) })
  rememberActiveWebRecording({ id, directory: created.path, projectId: destination.projectId, documentId: id })
  try {
    const manifest = await hub.startRecording(connectionId, backup, { id, directory: created.path, title: created.name })
    await documents.indexDocumentAt(created.path)
    logger.info('网页录制写进项目', { event: 'web_replay.recording.project', context: { recordingId: id, projectId: destination.projectId, directory: created.path } })
    return manifest
  } catch (error) {
    forgetActiveWebRecording(id)
    const cleaned = await fs.rm(created.path, { recursive: true, force: true }).then(() => true, () => false)
    throw cleaned ? error : leftBehind(error, created.path)
  }
}

export async function stopWebRecording(recordingId: string): Promise<WebRecordingManifest> {
  const manifest = await requireServer().stopRecording(recordingId)
  const location = await resolveWebRecordingLocation(recordingId).catch(() => null)
  forgetActiveWebRecording(recordingId)
  // The index row was made when recording started; refresh its duration and status now the files are final.
  if (location?.documentId) await getDocumentService().indexDocumentAt(location.directory).catch(error => logger.warn('网页录制没能更新作品索引', { event: 'web_replay.recording.index_failed', context: { recordingId }, error: String(error) }))
  return manifest
}

/**
 * Copies a recording folder into `<项目>/素材/录屏/<名称>.hjweb`. The source stays as it is (it may be the only original);
 * the copy gets a new id when the id is already used, so the two never resolve to each other.
 */
export async function importWebRecordingToProject(request: WebRecordingImportRequest): Promise<WebRecordingSummary> {
  const source = await notImported(async () => request.recordingId ? await resolveWebRecordingDirectory(request.recordingId) : path.resolve(request.source!))
  if (!(await fs.stat(source).catch(() => null))?.isDirectory()) throw notImportedError(new Error('录制文件夹不存在'))
  const manifest = await notImported(() => new WebRecordingStore(source).readManifest())
  if (manifest.status === 'recording') throw notImportedError(new Error('这段网页录制还没有保存完整（仍标记为录制中），不能放进项目'))
  const documents = getDocumentService()
  const title = request.name?.trim() || manifest.title || (stripHenjiExtension('web_recording', path.basename(source)) ?? path.basename(source)) || defaultProjectRecordingTitle(manifest.app.name, new Date(manifest.createdAt))
  const created = await notImported(() => documents.createFolderDocumentLocation({ kind: 'web_recording', container: { kind: 'project', projectId: request.projectId }, name: webRecordingFileName(title) }))
  try {
    await copyDirectoryContentsNoOverwrite(source, created.path, from => path.basename(from) !== 'edit-events')
    const id = await webRecordingIdTaken(manifest.id) ? crypto.randomUUID() : manifest.id
    const store = new WebRecordingStore(created.path)
    const { title: _old, ...rest } = await store.readManifest()
    await store.writeManifest({ ...rest, id, title: created.name })
    await documents.indexDocumentAt(created.path)
  } catch (error) {
    // 副本整个删干净才算“没有放进项目”；删不掉时项目里留了半份，如实报原错误，由调用方核对。
    const cleaned = await fs.rm(created.path, { recursive: true, force: true }).then(() => true, () => false)
    throw cleaned ? notImportedError(error) : leftBehind(error, created.path)
  }
  logger.info('网页录制已放进项目', { event: 'web_replay.recording.imported', context: { projectId: request.projectId, source, directory: created.path } })
  const summary = (await listWebRecordings()).find(item => item.directory === created.path)
  if (!summary) throw new Error('网页录制已复制进项目，但没能读回，请重新列出网页录制')
  return summary
}

/** 放进项目没有成功、项目里也没留下任何东西：渲染层据此告诉助手可以修正后直接重试。 */
function notImportedError(error: unknown): Error {
  const failure = error instanceof Error ? error : new Error(String(error))
  failure.name = 'WebRecordingNotImportedError'
  return failure
}
async function notImported<T>(work: () => T | Promise<T>): Promise<T> {
  try { return await work() } catch (error) { throw notImportedError(error) }
}
/**
 * 已经建了文件夹、失败后又没能删掉：项目里留下了半份录制。换成普通错误（不带原错误的类型），
 * 免得原来的“写入前拒绝”类型让执行层误判为没有改动。
 */
function leftBehind(error: unknown, directory: string): Error {
  return new Error(`${error instanceof Error ? error.message : String(error)}（没能清理已创建的 ${path.basename(directory)}，请检查后再试）`)
}

const TRASH = '.trash'
/** Beside a trashed project recording: where it came from, so restoring puts it back there. */
const trashOrigin = (id: string): string => path.join(webRecordingsRoot(), TRASH, `${id}.origin.json`)

/** The newest replay video inside a recording directory (names sort by render time). */
async function latestVideo(directory: string): Promise<string | null> {
  const newest = newestReplayName(await fs.readdir(directory).catch(() => [] as string[]))
  return newest ? path.join(directory, newest) : null
}

/** Every recording, in the app-data root and in projects, newest first. Unreadable directories are skipped and logged. */
export async function listWebRecordings(): Promise<WebRecordingSummary[]> {
  const manifests = await Promise.all((await listWebRecordingLocations()).map(async ({ directory, projectId }) => {
    try {
      const backup = path.join(directory, BACKUP_VIDEO_FILE)
      return { ...await new WebRecordingStore(directory).readManifest(), directory, projectId, video: await latestVideo(directory), backupVideo: await fs.access(backup).then(() => backup, () => null), takes: (await listWebReplayTakes(directory)).map(takeInfo) }
    } catch (error) {
      logger.warn('网页录制无法读取', { event: 'web_replay.recording.unreadable', context: { directory }, error: String(error) })
      return null
    }
  }))
  return manifests.filter((m): m is WebRecordingSummary => m !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Deleting moves the directory to a trash folder beside it, so the operation can be undone. */
export async function removeWebRecording(recordingId: string): Promise<void> {
  if ((server?.apps() ?? []).some(app => app.recordingId === recordingId)) throw new Error('这段网页录制还在进行，请先停止')
  if (rendering.has(recordingId)) throw new Error('这段网页录制正在重演，请等待完成')
  const location = await resolveWebRecordingLocation(recordingId)
  const trash = path.join(webRecordingsRoot(), TRASH)
  await fs.mkdir(trash, { recursive: true })
  await fs.rm(path.join(trash, recordingId), { recursive: true, force: true })
  await fs.rm(trashOrigin(recordingId), { force: true })
  // A project recording leaves its project for the app-data trash too, so deleting can be undone the same way.
  if (location.documentId) await fs.writeFile(trashOrigin(recordingId), JSON.stringify({ directory: location.directory }))
  await moveWebRecordingDirectory(location.directory, path.join(trash, recordingId))
  await markWebRecordingTrashed(trash, recordingId)
  if (location.documentId) await getDocumentService().forgetDocument(location.documentId)
  logger.info('网页录制已移到回收区', { event: 'web_replay.recording.removed', context: { recordingId, projectId: location.projectId } })
}

export async function restoreWebRecording(recordingId: string): Promise<void> {
  const trashed = path.join(webRecordingsRoot(), TRASH, recordingId)
  const origin = await fs.readFile(trashOrigin(recordingId), 'utf8').then(text => (JSON.parse(text) as { directory: string }).directory, () => null)
  const target = origin ?? path.join(webRecordingsRoot(), (await new WebRecordingStore(trashed).readManifest()).id)
  if (await fs.access(target).then(() => true, () => false)) throw new Error('原位置已有同名的文件夹，没能恢复这段网页录制')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await moveWebRecordingDirectory(trashed, target)
  await forgetWebRecordingTrashMark(path.dirname(trashed), recordingId)
  if (origin) { await getDocumentService().indexDocumentAt(target); await fs.rm(trashOrigin(recordingId), { force: true }) }
  logger.info('网页录制已恢复', { event: 'web_replay.recording.restored', context: { recordingId } })
}

/** 启动时在后台清掉回收区里删除满 30 天的网页录制；失败只记日志，录制留到下次再清。 */
export async function cleanWebRecordingTrash(): Promise<void> {
  const { purged, failed } = await purgeExpiredWebRecordingTrash(path.join(webRecordingsRoot(), TRASH))
  if (purged.length) logger.info('回收区里过期的网页录制已清理', { event: 'web_replay.trash.purged', context: { count: purged.length, recordingIds: purged } })
  for (const item of failed) logger.warn('回收区里过期的网页录制没能清理', { event: 'web_replay.trash.purge_failed', context: { recordingId: item.id }, error: item.error })
}

/**
 * Renaming rewrites the manifest's title. A project recording is a document named by its folder, so the folder is
 * renamed through the document service (which also writes the title); app-data recordings keep their id folder.
 */
export async function renameWebRecordings(items: Array<{ recordingId: string; title: string | null }>): Promise<void> {
  for (const { recordingId, title } of items) {
    const location = await resolveWebRecordingLocation(recordingId)
    const store = new WebRecordingStore(location.directory)
    const { title: _old, ...manifest } = await store.readManifest()
    if (location.documentId) {
      await getDocumentService().renameDocument({ target: { id: location.documentId, path: location.directory }, name: webRecordingFileName(title ?? defaultProjectRecordingTitle(manifest.app.name, new Date(manifest.createdAt))) })
      continue
    }
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
  const directory = path.join(await resolveWebRecordingDirectory(recordingId), BACKUP_AUDIO_DIRECTORY)
  await fs.mkdir(directory, { recursive: true })
  return directory
}

/** The page stops its sound after the recording ended elsewhere; the picture may still be saving. */
export async function mixWebRecordingAudio(recordingId: string): Promise<boolean> { return mixWebRecordingBackupAudio(await resolveWebRecordingDirectory(recordingId), 60_000) }

export async function getWebRecording(recordingId: string): Promise<WebRecordingManifest> { return new WebRecordingStore(await resolveWebRecordingDirectory(recordingId)).readManifest() }

export function takeInfo(take: WebReplayTakeSummary): WebRecordingTakeInfo {
  return { name: take.name, directory: take.directory, video: take.videoPath, frames: take.frames, durationMs: Math.round(take.durationUs / 1000), fps: take.fps, pointer: take.pointer, createdAt: take.createdAt, conflicts: take.conflicts }
}

function pageOf(entries: unknown[], offset: number, limit: number): WebReplayReadResult {
  const slice = entries.slice(offset, offset + limit)
  return { entries: slice, total: entries.length, nextOffset: offset + slice.length < entries.length ? offset + slice.length : null }
}

/**
 * Full, unredacted track pages (the user chose full assistant visibility); blob bodies stay as references. With `take`,
 * the boxes, text and behavior tracks are that take's own (on its output clock), and `timemap` pairs output and
 * recording time; the data track is the recording's in either case.
 */
export async function readWebRecording(request: WebReplayReadRequest): Promise<WebReplayReadResult> {
  const recordingDirectory = await resolveWebRecordingDirectory(request.recordingId)
  const take = request.take ? await readWebReplayTake(recordingDirectory, request.take) : null
  if (request.track === 'timemap') {
    if (!take) throw new Error('timemap 只属于按导演稿出的版本，请同时给 take（版本名）')
    const map = JSON.parse(await fs.readFile(path.join(take.directory, TAKE_FILES.timeMap), 'utf8')) as { pieces: object[]; cuts: object[] }
    return pageOf([...map.pieces, ...map.cuts.map(cut => ({ kind: 'cut', ...cut }))], request.offset, request.limit)
  }
  if (take && request.track === 'behavior') return pageOf(await readWebReplayTakeBehavior(take.directory), request.offset, request.limit)
  const directory = take && (request.track === 'boxes' || request.track === 'text') ? take.directory : recordingDirectory
  if (request.track === 'boxes') {
    const { key, keyPrefix, fromSeconds, toSeconds } = request
    return readBoxTrack(directory, { key, keyPrefix, fromSeconds, toSeconds }, request.offset, request.limit)
  }
  if (request.track === 'text') {
    if (request.query) { const { matches, total } = await searchTextTrack(directory, request.query, request.offset + request.limit); const page = matches.slice(request.offset); return { entries: page, total, nextOffset: request.offset + page.length < total ? request.offset + page.length : null } }
    const { entries, total } = await readTextTrack(directory, request.offset, request.limit)
    return { entries, total, nextOffset: request.offset + entries.length < total ? request.offset + entries.length : null }
  }
  const store = new WebRecordingStore(directory)
  const entries: unknown[] = request.track === 'data' ? await store.readData().then(d => [...d.calls, ...d.external.map(e => ({ kind: 'external', ...e }))]) : await store.readBehavior()
  return pageOf(entries, request.offset, request.limit)
}

export async function revealWebRecording(recordingId: string, file?: string): Promise<void> {
  const directory = await resolveWebRecordingDirectory(recordingId)
  const target = file ? path.resolve(file) : directory
  if (target !== directory && !target.startsWith(directory + path.sep)) throw new Error('只能打开这段录制自己的文件')
  if (file) shell.showItemInFolder(target)
  else { const error = await shell.openPath(target); if (error) throw new Error(error) }
}

const rendering = new Set<string>()
/** 同一时间只重演一段：几段同时渲染会抢 GPU、CPU 与编码器，每段都更慢。 */
const renderQueue = new ReplayRenderQueue()
export async function renderWebRecording(request: WebReplayRenderRequest, signal?: AbortSignal, onProgress?: (progress: WebReplayRenderProgress) => void): Promise<WebReplayRenderResult> {
  const recordingId = request.recordingId
  if (rendering.has(recordingId)) throw new Error('这段网页录制正在重演，请等待完成')
  rendering.add(recordingId)
  try {
    const directory = await resolveWebRecordingDirectory(recordingId)
    const queuedAt = Date.now()
    return await renderQueue.run(() => renderReplay(request, directory, Date.now() - queuedAt, signal, onProgress), {
      signal,
      onQueued: ahead => logger.info('网页重演排队，等前面的重演结束', { event: 'web_replay.replay.queued', context: { recordingId, ahead, textOnly: request.textOnly === true } }),
      onCancelled: () => logger.info('排队中的网页重演已取消', { event: 'web_replay.replay.queue_cancelled', context: { recordingId, waitedMs: Date.now() - queuedAt } }),
    })
  } finally { rendering.delete(recordingId) }
}

/** 导演稿：直接给的或从文件读的；校验失败时（逐条点名字段）一帧也不渲染。只给版本名时是照录制原样的版本。 */
async function directorOf(request: WebReplayRenderRequest, recordingDurationUs: () => Promise<number>): Promise<WebReplayDirector | null> {
  if (request.director === undefined && !request.directorFile && !request.take) return null
  let raw: unknown = request.director ?? { version: 1 }
  if (request.directorFile) {
    const text = await fs.readFile(request.directorFile, 'utf8').catch(error => { throw new WebReplayDirectorError([`directorFile：读不了（${String((error as Error)?.message ?? error)}）`]) })
    try { raw = JSON.parse(text) } catch (error) { throw new WebReplayDirectorError([`directorFile：不是合法的 JSON（${String((error as Error)?.message ?? error)}）`]) }
  }
  const director = parseWebReplayDirector(raw)
  checkDirectorAgainstRecording(director, await recordingDurationUs())
  return director
}

/** 逐帧重演（页面时间由重演推进，每帧都在录制时刻上），视频或只出文字轨与位置轨；有导演稿时出一个版本。 */
async function renderReplay(request: WebReplayRenderRequest, directory: string, waitedMs: number, signal?: AbortSignal, onProgress?: (progress: WebReplayRenderProgress) => void): Promise<WebReplayRenderResult> {
  const recordingId = request.recordingId
  const director = await directorOf(request, async () => (await new WebRecordingStore(directory).readManifest()).durationUs)
  if (director) {
    const name = request.take ?? `导演稿 ${new Date().toISOString().replace(/[:.]/g, '-')}`
    logger.info('开始按导演稿重演版本', { event: 'web_replay.take.start', context: { recordingId, take: name, waitedMs, textOnly: request.textOnly === true } })
    const { result, take } = await renderWebReplayTake(directory, {
      recordingId, name, director, fps: request.fps, pointer: request.pointer === true, longEdge: request.longEdge, textOnly: request.textOnly, boxSelectors: request.boxSelectors, signal,
      onFrame: onProgress ? (progress, frame) => onProgress({ recordingId, progress, frame }) : undefined,
    })
    const { takeTracks, ...rest } = result
    return { ...rest, output: take.videoPath ?? path.join(take.directory, TAKE_FILES.text), take: { ...takeInfo(take), steps: takeTracks?.steps ?? [] } }
  }
  const textTrack = path.join(directory, TEXT_TRACK_FILE)
  let options: ReplayOptions
  if (request.textOnly) {
    logger.info('开始网页重演文字轨', { event: 'web_replay.replay.text_start', context: { recordingId, waitedMs } })
    options = { output: textTrack, fps: request.fps ?? 30, pointer: false, video: false, textTrack, boxSelectors: request.boxSelectors, signal, onFrame: onProgress ? progress => onProgress({ recordingId, progress, frame: '' }) : undefined }
  } else {
    // 干净画面（不画鼠标）的重演以 .clean.mp4 结尾：导入剪辑据此决定重画整个鼠标，还是只补点击。
    const output = request.output ?? path.join(directory, `replay-${new Date().toISOString().replace(/[:.]/g, '-')}${request.pointer === false ? REPLAY_CLEAN_SUFFIX : '.mp4'}`)
    await fs.mkdir(path.dirname(output), { recursive: true })
    logger.info('开始网页重演', { event: 'web_replay.replay.start', context: { recordingId, output, waitedMs } })
    options = { output, fps: request.fps, pointer: request.pointer !== false, longEdge: request.longEdge, textTrack, boxSelectors: request.boxSelectors, signal, onFrame: onProgress ? (progress, frame) => onProgress({ recordingId, progress, frame }) : undefined }
  }
  return WebRecordingPlayer.open(directory).render(options)
}
