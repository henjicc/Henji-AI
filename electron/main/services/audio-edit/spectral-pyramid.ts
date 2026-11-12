import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { audioEditSpectralTileRequestSchema, spectralColumnCount, spectralLowBins, spectralHighBins, spectralResolution, SPECTRAL_PERSISTED_MIN_LEVEL, SPECTRAL_TILE_COLUMNS, type AudioEditSpectralTile, type AudioEditSpectralTileRequest, type AudioEditSpectralProgress } from '../../../../src/core/audioEdit/spectralPyramid'
import { createMainLogger } from '../logging'
import { audioDiskBudgetBytes } from '../audio/cache-budget'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { requireAudioEditProject } from './project-store'
import { audioEditSpectralCacheDirectory, identifyAudioEditSource, prepareAudioEditAudio, verifyAudioEditSource } from './media'
import { prepareAudioEditRenderSource } from './render'
import { audioRenderKey, cachedAudioFile } from './render-cache'
import { spectralWorker } from './spectral-worker-client'
import { readSpectralManifest, readSpectralRange, type SpectralMetadata } from './spectral-storage'
import { touchSpectralTile, trimSpectralTiles } from './spectral-tile-budget'
import { registerAudioEditTaskController } from './task-store'

const logger = createMainLogger('main.audio_edit.spectral')
const requests = new Map<string, AbortController>()
const listeners = new Set<(event: AudioEditSpectralProgress) => void>()
interface Background { directory: string; operation: Promise<void>; observers: Map<string, Omit<AudioEditSpectralProgress, 'coveredFrames' | 'durationFrames' | 'done'>> }
const backgrounds = new Map<string, Background>()
interface Immediate { controller: AbortController; operation: Promise<string>; users: number }
const immediate = new Map<string, Immediate>()

export function subscribeAudioEditSpectralProgress(listener: (event: AudioEditSpectralProgress) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function cancelAudioEditSpectralTile(requestId: string): void { requests.get(requestId)?.abort() }
function aborted(): Error { return new Error('频谱读取已取消') }
/** 仅借用内存生命周期登记，防止文档清理器删除在读写的缓存；不创建任务回执。 */
function protectCache(projectId: string, controller: AbortController): () => void {
  return registerAudioEditTaskController(`spectral-${randomUUID()}`, projectId, controller, true)
}
async function prepareInput(projectId: string, prepare: () => Promise<string>): Promise<string> {
  const release = protectCache(projectId, new AbortController())
  try { return await prepare() } finally { release() }
}
function wait<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => undefined); signal.throwIfAborted() }
  return new Promise((resolve, reject) => {
    const cancel = (): void => reject(aborted())
    signal.addEventListener('abort', cancel, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

/**
 * 上次没算完（超时、中断、退出）留下的目录：清单里有已算完的部分，worker 从对齐点续算。
 * 同一键只留覆盖最多的一份，其余删掉。只能在拿到该素材唯一的启动权之后调用，否则会删掉别人刚建的目录。
 */
async function resumableDirectory(cache: string, key: string): Promise<string | undefined> {
  const pattern = new RegExp(`^${key}-[a-f0-9-]+$`)
  const entries = await fs.readdir(cache, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(entries.filter(entry => entry.isDirectory() && pattern.test(entry.name)).map(async entry => {
    const directory = path.join(cache, entry.name)
    const manifest = await readSpectralManifest(directory).catch(() => undefined)
    return { directory, covered: manifest && !manifest.done ? manifest.coveredFrames : -1 }
  }))
  candidates.sort((a, b) => b.covered - a.covered)
  const [best, ...rest] = candidates
  await Promise.all(rest.map(item => removeUnmanagedCachePath(item.directory, { recursive: true, force: true }).catch(() => undefined)))
  if (best && best.covered >= 0) return best.directory
  if (best) await removeUnmanagedCachePath(best.directory, { recursive: true, force: true }).catch(() => undefined)
  return undefined
}

/** 同一素材同一时刻只有一个读取者在查完成指针、清理残留目录并启动计算；其余读取者等它的结果。 */
const claims = new Map<string, Promise<string>>()

async function startBackground(cache: string, key: string, input: string, request: AudioEditSpectralTileRequest, revision: number): Promise<string> {
  const identity = path.join(cache, key)
  const observer = { projectId: request.projectId, mode: request.mode, revision }
  const observerKey = JSON.stringify(observer)
  const existing = backgrounds.get(identity)
  if (existing) { existing.observers.set(observerKey, observer); return existing.directory }
  let claim = claims.get(identity)
  if (!claim) {
    claim = claimBackground(cache, key, identity, input, request, observer)
    claims.set(identity, claim)
    void claim.finally(() => { if (claims.get(identity) === claim) claims.delete(identity) }).catch(() => undefined)
  }
  const directory = await claim
  backgrounds.get(identity)?.observers.set(observerKey, observer)
  return directory
}

async function claimBackground(cache: string, key: string, identity: string, input: string, request: AudioEditSpectralTileRequest, observer: { projectId: string; mode: AudioEditSpectralTileRequest['mode']; revision: number }): Promise<string> {
  // 完成指针只在整文件任务成功后由 cachedAudioFile 原子发布。
  try {
    const name = await fs.readFile(`${identity}.pyramid`, 'utf8')
    if (!new RegExp(`^${key}-[a-f0-9-]+$`).test(name)) throw new Error('频谱缓存路径无效')
    const directory = path.join(cache, name)
    if ((await readSpectralManifest(directory))?.done) return directory
    throw new Error('频谱完成缓存缺失')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const resumable = await resumableDirectory(cache, key)
  const directory = resumable ?? path.join(cache, `${key}-${randomUUID()}`)
  const job: Background = { directory, operation: Promise.resolve(), observers: new Map([[JSON.stringify(observer), observer]]) }
  backgrounds.set(identity, job)
  const began = performance.now()
  const controller = new AbortController()
  const release = protectCache(request.projectId, controller)
  let last = -Infinity
  const emit = (progress: { coveredFrames: number; durationFrames: number; done: boolean }): void => {
    const now = performance.now()
    if (!progress.done && now - last < 250) return
    last = now
    for (const context of job.observers.values()) for (const listener of listeners) listener({ ...context, ...progress })
  }
  job.operation = (async () => {
    logger.info('开始计算整段音频频谱', { event: 'audio_edit.spectral.start', context: { ...observer, resumed: Boolean(resumable) } })
    try {
      await cachedAudioFile(cache, key, 'pyramid', async temporary => {
        await spectralWorker.request({ type: 'spectral_build', input_path: input, output_directory: directory }, controller.signal, progress => { if (!progress.done) emit(progress) })
        const manifest = await readSpectralManifest(directory)
        if (!manifest?.done) throw new Error('整段频谱未完成')
        await fs.writeFile(temporary, path.basename(directory), 'utf8')
      })
      const completed = await readSpectralManifest(directory)
      if (!completed?.done) throw new Error('整段频谱完成清单缺失')
      emit({ coveredFrames: completed.durationFrames, durationFrames: completed.durationFrames, done: true })
      logger.info('整段音频频谱计算完成', { event: 'audio_edit.spectral.completed', context: { ...observer, durationFrames: completed.durationFrames, resumed: Boolean(resumable), elapsedMs: performance.now() - began } })
    } catch (error) {
      // 已算完的部分与清单留着，下次读取从清单的覆盖位置续算，不从头再来。
      const coveredFrames = (await readSpectralManifest(directory).catch(() => undefined))?.coveredFrames
      logger.error('整段音频频谱计算未完成，已算部分保留待续算', { event: 'audio_edit.spectral.failed', error, context: { ...observer, coveredFrames, elapsedMs: performance.now() - began } })
      throw error
    } finally { backgrounds.delete(identity); release() }
  })()
  // 后台失败已有结构化日志；不制造未处理拒绝，下一次读取可以重新启动。
  void job.operation.catch(() => undefined)
  return directory
}

async function immediateFile(cache: string, key: string, input: string, request: AudioEditSpectralTileRequest, metadata: SpectralMetadata, signal: AbortSignal): Promise<string> {
  const identity = path.join(cache, key)
  let job = immediate.get(identity)
  if (job?.controller.signal.aborted) {
    await wait(job.operation.catch(() => undefined), signal)
    return immediateFile(cache, key, input, request, metadata, signal)
  }
  if (!job) {
    const controller = new AbortController()
    const release = protectCache(request.projectId, controller)
    const operation = cachedAudioFile(cache, key, 'rg', async output => {
      const result = await spectralWorker.request<SpectralMetadata & { columnCount: number }>({ type: 'spectral_tile', input_path: input, output_path: output,
        level: request.level, column_start: request.tile * SPECTRAL_TILE_COLUMNS, column_count: SPECTRAL_TILE_COLUMNS }, controller.signal)
      const count = Math.min(SPECTRAL_TILE_COLUMNS, Math.max(0, spectralColumnCount(request.level, metadata.durationFrames) - request.tile * SPECTRAL_TILE_COLUMNS))
      for (const field of ['sampleRate', 'channels', 'durationFrames', 'lowBins', 'highBins'] as const) {
        if (result[field] !== metadata[field]) throw new Error('频谱计算结果与素材元数据不匹配')
      }
      if (result.columnCount !== count || (await fs.stat(output)).size !== count * metadata.channels * (metadata.lowBins + metadata.highBins) * 2) throw new Error('频谱计算结果列数不匹配')
    }, controller.signal).finally(release)
    job = { controller, operation, users: 0 }
    immediate.set(identity, job)
    void operation.finally(() => { if (immediate.get(identity) === job) immediate.delete(identity) }).catch(() => undefined)
  }
  job.users++
  try { return await wait(job.operation, signal) }
  finally { if (--job.users === 0) job.controller.abort() }
}

let trimming = false, lastTrim = 0
/** 细层块读写后按节流检查限额（全局媒体缓存上限的三分之一，至少 1 GB）；一次只清一遍。 */
function scheduleTileTrim(cache: string): void {
  if (trimming || Date.now() - lastTrim < 30_000) return
  trimming = true; lastTrim = Date.now()
  const budgetBytes = audioDiskBudgetBytes(3, 1024 ** 3)
  void trimSpectralTiles(cache, { budgetBytes }).then(({ removedFiles, removedBytes }) => {
    if (removedFiles) logger.info('频谱细层块超过限额，已清掉最久没用的', { event: 'audio_edit.spectral.tiles_trimmed', context: { removedFiles, removedBytes, budgetBytes } })
  }).catch(() => undefined).finally(() => { trimming = false })
}

/** 高频读路径没有任务表、逐块 info 日志或单次子进程。 */
export async function getAudioEditSpectralTile(raw: AudioEditSpectralTileRequest): Promise<AudioEditSpectralTile> {
  const request = audioEditSpectralTileRequestSchema.parse(raw)
  if (!Number.isSafeInteger(request.tile * SPECTRAL_TILE_COLUMNS)) throw new Error('频谱块范围超出安全整数范围')
  if (requests.has(request.requestId)) throw new Error('频谱请求 ID 已在使用')
  const controller = new AbortController()
  requests.set(request.requestId, controller)
  const release = protectCache(request.projectId, controller)
  const signal = controller.signal
  try {
    const project = await wait(requireAudioEditProject(request.projectId), signal)
    await wait(verifyAudioEditSource(project, false, signal), signal)
    const identity = project.source.identity ?? await wait(identifyAudioEditSource(project.source.sourcePath, signal), signal)
    const input = await wait(prepareInput(project.id, () => request.mode === 'edited' ? prepareAudioEditRenderSource(project) : prepareAudioEditAudio(project)), signal)
    const cache = audioEditSpectralCacheDirectory()
    const revision = request.mode === 'source' ? 0 : project.revision
    const key = audioRenderKey(['spectral-pyramid-v1', identity, project.source.audioStreamIndex, project.source.sampleRate,
      project.source.channels, project.source.durationFrames, request.mode, request.mode === 'edited' ? path.basename(input) : undefined])
    const metadata: SpectralMetadata = { sampleRate: project.source.sampleRate, channels: project.source.channels,
      durationFrames: project.source.durationFrames, lowBins: spectralLowBins(project.source.sampleRate, request.level), highBins: spectralHighBins(request.level) }
    const directory = await wait(startBackground(cache, key, input, request, revision), signal)
    const base = { ...metadata, mode: request.mode, revision, level: request.level, tile: request.tile }
    if (request.level >= SPECTRAL_PERSISTED_MIN_LEVEL) {
      const data = await wait(readSpectralRange(directory, request.level, request.tile, metadata), signal)
      return { ...base, ...data }
    }
    const columnStart = request.tile * SPECTRAL_TILE_COLUMNS
    const columnCount = Math.min(SPECTRAL_TILE_COLUMNS, Math.max(0, spectralColumnCount(request.level, metadata.durationFrames) - columnStart))
    if (!columnCount) return { ...base, columnStart, columnCount, values: new Uint8Array(), complete: true }
    // 负层分析窗会随缩放变化，旧的固定窗块不得命中；整文件缓存与非负层保持原键。
    const tileKey = request.level < 0 ? [key, request.level, request.tile, 'adaptive-hann-v1', spectralResolution(request.level)] : [key, request.level, request.tile]
    const file = await immediateFile(cache, audioRenderKey(tileKey), input, request, metadata, signal)
    const bytes = await wait(fs.readFile(file), signal)
    void touchSpectralTile(file)
    scheduleTileTrim(cache)
    if (bytes.length !== metadata.channels * columnCount * (metadata.lowBins + metadata.highBins) * 2) throw new Error('频谱块缓存长度不匹配')
    return { ...base, columnStart, columnCount, complete: true, values: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
  } finally { requests.delete(request.requestId); release() }
}
