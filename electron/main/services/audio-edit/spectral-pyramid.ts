import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { audioEditSpectralTileRequestSchema, spectralColumnCount, spectralLowBins, SPECTRAL_HIGH_BINS, SPECTRAL_PERSISTED_MIN_LEVEL, SPECTRAL_TILE_COLUMNS, type AudioEditSpectralTile, type AudioEditSpectralTileRequest, type AudioEditSpectralProgress } from '../../../../src/core/audioEdit/spectralPyramid'
import { createMainLogger } from '../logging'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { requireAudioEditProject } from './project-store'
import { audioEditSpectralCacheDirectory, identifyAudioEditSource, prepareAudioEditAudio, verifyAudioEditSource } from './media'
import { prepareAudioEditRenderSource } from './render'
import { audioRenderKey, cachedAudioFile } from './render-cache'
import { spectralWorker } from './spectral-worker-client'
import { readSpectralManifest, readSpectralRange, type SpectralMetadata } from './spectral-storage'
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

async function startBackground(cache: string, key: string, input: string, request: AudioEditSpectralTileRequest, revision: number): Promise<string> {
  const identity = path.join(cache, key)
  const observer = { projectId: request.projectId, mode: request.mode, revision }
  const observerKey = JSON.stringify(observer)
  let existing = backgrounds.get(identity)
  if (existing) { existing.observers.set(observerKey, observer); return existing.directory }
  // 完成指针只在整文件任务成功后由 cachedAudioFile 原子发布。
  try {
    const name = await fs.readFile(`${identity}.pyramid`, 'utf8')
    if (!new RegExp(`^${key}-[a-f0-9-]+$`).test(name)) throw new Error('频谱缓存路径无效')
    const directory = path.join(cache, name)
    if ((await readSpectralManifest(directory))?.done) return directory
    throw new Error('频谱完成缓存缺失')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  // 上面的读取可能让出事件循环，必须再次检查，保证同素材只有一遍计算。
  existing = backgrounds.get(identity)
  if (existing) { existing.observers.set(observerKey, observer); return existing.directory }
  const directory = path.join(cache, `${key}-${randomUUID()}`)
  const job: Background = { directory, operation: Promise.resolve(), observers: new Map([[observerKey, observer]]) }
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
    logger.info('开始计算整段音频频谱', { event: 'audio_edit.spectral.start', context: observer })
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
      logger.info('整段音频频谱计算完成', { event: 'audio_edit.spectral.completed', context: { ...observer, elapsedMs: performance.now() - began } })
    } catch (error) {
      logger.error('整段音频频谱计算失败', { event: 'audio_edit.spectral.failed', error, context: { ...observer, elapsedMs: performance.now() - began } })
      await removeUnmanagedCachePath(directory, { recursive: true, force: true })
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
    const input = await wait(prepareInput(project.id, () => request.mode === 'edited' ? prepareAudioEditRenderSource(project, project.vstEnabled) : prepareAudioEditAudio(project)), signal)
    const cache = audioEditSpectralCacheDirectory()
    const revision = request.mode === 'source' ? 0 : project.revision
    const key = audioRenderKey(['spectral-pyramid-v1', identity, project.source.audioStreamIndex, project.source.sampleRate,
      project.source.channels, project.source.durationFrames, request.mode, request.mode === 'edited' ? path.basename(input) : undefined])
    const metadata: SpectralMetadata = { sampleRate: project.source.sampleRate, channels: project.source.channels,
      durationFrames: project.source.durationFrames, lowBins: spectralLowBins(project.source.sampleRate), highBins: SPECTRAL_HIGH_BINS }
    const directory = await wait(startBackground(cache, key, input, request, revision), signal)
    const base = { ...metadata, mode: request.mode, revision, level: request.level, tile: request.tile }
    if (request.level >= SPECTRAL_PERSISTED_MIN_LEVEL) {
      const data = await wait(readSpectralRange(directory, request.level, request.tile, metadata), signal)
      return { ...base, ...data }
    }
    const columnStart = request.tile * SPECTRAL_TILE_COLUMNS
    const columnCount = Math.min(SPECTRAL_TILE_COLUMNS, Math.max(0, spectralColumnCount(request.level, metadata.durationFrames) - columnStart))
    if (!columnCount) return { ...base, columnStart, columnCount, values: new Uint8Array(), complete: true }
    const file = await immediateFile(cache, audioRenderKey([key, request.level, request.tile]), input, request, metadata, signal)
    const bytes = await wait(fs.readFile(file), signal)
    if (bytes.length !== metadata.channels * columnCount * (metadata.lowBins + metadata.highBins) * 2) throw new Error('频谱块缓存长度不匹配')
    return { ...base, columnStart, columnCount, complete: true, values: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
  } finally { requests.delete(request.requestId); release() }
}
