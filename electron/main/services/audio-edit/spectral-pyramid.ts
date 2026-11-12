import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { audioEditSpectralTileRequestSchema, spectralColumnCount, spectralHop, spectralLowBins, spectralHighBins, spectralResolution, SPECTRAL_PERSISTED_MIN_LEVEL, SPECTRAL_TILE_COLUMNS, type AudioEditSpectralTile, type AudioEditSpectralTileRequest, type AudioEditSpectralProgress } from '../../../../src/core/audioEdit/spectralPyramid'
import { createMainLogger } from '../logging'
import { audioDiskBudgetBytes } from '../audio/cache-budget'
import { audioFileStamp, findAudioLineageAncestor, writeAudioCacheRecord, type AudioLineageRange } from '../audio/lineage'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { requireAudioEditProject } from './project-store'
import { audioEditSpectralCacheDirectory, prepareAudioEditAudio, verifyAudioEditSource } from './media'
import { audioEditSourceContentKey } from './source-identity'
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

/** 已算完的整段目录（完成指针指向、清单已完成）；没有返回 undefined。 */
async function completedDirectory(cache: string, key: string): Promise<string | undefined> {
  const name = await fs.readFile(path.join(cache, `${key}.pyramid`), 'utf8').catch(() => undefined)
  if (!name || !new RegExp(`^${key}-[a-f0-9-]+$`).test(name)) return undefined
  const directory = path.join(cache, name)
  return (await readSpectralManifest(directory).catch(() => undefined))?.done ? directory : undefined
}

/*
 * 频谱目录的键按作品身份算（同一份声音在不同作品、不同素材身份下是不同的键）。按来历找上一版时只知道文件，
 * 所以算完（或读到已完成的目录）时另记一条“输入文件 → 频谱键”的索引，文件被重写（文件戳变了）索引即失效。
 */
async function indexPath(cache: string, file: string): Promise<string> {
  const resolved = await fs.realpath(file).catch(() => path.resolve(file))
  return path.join(cache, 'index', `${createHash('sha256').update(process.platform === 'win32' ? resolved.toLowerCase() : resolved).digest('hex')}.json`)
}
async function rememberSpectralKey(cache: string, file: string, key: string): Promise<void> {
  const stamp = await audioFileStamp(file)
  if (!stamp) return
  const location = await indexPath(cache, file)
  const current = await fs.readFile(location, 'utf8').then(text => JSON.parse(text) as { stamp?: string; key?: string }, () => undefined).catch(() => undefined)
  if (current?.stamp !== stamp || current.key !== key) await writeAudioCacheRecord(location, { stamp, key })
}
async function spectralKeyOf(cache: string, file: string): Promise<string | undefined> {
  const record = await fs.readFile(await indexPath(cache, file), 'utf8').then(text => JSON.parse(text) as { stamp?: unknown; key?: unknown }, () => undefined).catch(() => undefined)
  return typeof record?.key === 'string' && /^[a-f0-9]{64}$/.test(record.key) && record.stamp === await audioFileStamp(file) ? record.key : undefined
}

/** 派生来源：沿文件来历找到第一个整段频谱已算完的上一版，以及两版之间可能不同的帧（长度变了时含变化处到结尾）。 */
type DeriveSource = () => Promise<{ directory: string; dirty: AudioLineageRange[]; hops: number } | undefined>

async function startBackground(cache: string, key: string, input: string, request: AudioEditSpectralTileRequest, revision: number, deriveSource?: DeriveSource): Promise<string> {
  const identity = path.join(cache, key)
  const observer = { projectId: request.projectId, mode: request.mode, revision }
  const observerKey = JSON.stringify(observer)
  const existing = backgrounds.get(identity)
  if (existing) { existing.observers.set(observerKey, observer); return existing.directory }
  let claim = claims.get(identity)
  if (!claim) {
    claim = claimBackground(cache, key, identity, input, request, observer, deriveSource)
    claims.set(identity, claim)
    void claim.finally(() => { if (claims.get(identity) === claim) claims.delete(identity) }).catch(() => undefined)
  }
  const directory = await claim
  backgrounds.get(identity)?.observers.set(observerKey, observer)
  return directory
}

async function claimBackground(cache: string, key: string, identity: string, input: string, request: AudioEditSpectralTileRequest, observer: { projectId: string; mode: AudioEditSpectralTileRequest['mode']; revision: number }, deriveSource?: DeriveSource): Promise<string> {
  // 完成指针只在整文件任务成功后由 cachedAudioFile 原子发布。
  try {
    const name = await fs.readFile(`${identity}.pyramid`, 'utf8')
    if (!new RegExp(`^${key}-[a-f0-9-]+$`).test(name)) throw new Error('频谱缓存路径无效')
    const directory = path.join(cache, name)
    if ((await readSpectralManifest(directory))?.done) {
      await rememberSpectralKey(cache, input, key)
      return directory
    }
    throw new Error('频谱完成缓存缺失')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const resumable = await resumableDirectory(cache, key)
  // 没有可续算的目录时，先找能派生的上一版：只重算改动波及的列，不整段做 STFT。
  const parent = resumable ? undefined : await deriveSource?.().catch(() => undefined)
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
    logger.info('开始计算整段音频频谱', { event: 'audio_edit.spectral.start', context: { ...observer, resumed: Boolean(resumable), derived: Boolean(parent) } })
    let recomputedFrames: number | undefined
    try {
      await cachedAudioFile(cache, key, 'pyramid', async temporary => {
        if (parent) {
          try {
            const result = await spectralWorker.request<{ recomputedFrames: number }>({ type: 'spectral_derive', input_path: input, parent_directory: parent.directory, output_directory: directory, dirty: parent.dirty }, controller.signal)
            recomputedFrames = result.recomputedFrames
          } catch (error) {
            if (controller.signal.aborted) throw error
            // 派生不成（上一版是旧版本算的、文件被清理……）就在同一目录整段计算。
            logger.warn('频谱按列派生未完成，在同一目录整段计算', { event: 'audio_edit.spectral.derive_fallback', error, context: { ...observer, hops: parent.hops } })
            await removeUnmanagedCachePath(directory, { recursive: true, force: true })
          }
        }
        if (recomputedFrames === undefined) await spectralWorker.request({ type: 'spectral_build', input_path: input, output_directory: directory }, controller.signal, progress => { if (!progress.done) emit(progress) })
        const manifest = await readSpectralManifest(directory)
        if (!manifest?.done) throw new Error('整段频谱未完成')
        await fs.writeFile(temporary, path.basename(directory), 'utf8')
      })
      const completed = await readSpectralManifest(directory)
      if (!completed?.done) throw new Error('整段频谱完成清单缺失')
      await rememberSpectralKey(cache, input, key)
      emit({ coveredFrames: completed.durationFrames, durationFrames: completed.durationFrames, done: true })
      logger.info('整段音频频谱计算完成', { event: 'audio_edit.spectral.completed', context: {
        ...observer, durationFrames: completed.durationFrames, derived: recomputedFrames !== undefined, recomputedFrames: recomputedFrames ?? completed.durationFrames,
        ...(parent && recomputedFrames !== undefined ? { hops: parent.hops } : {}), resumed: Boolean(resumable), elapsedMs: performance.now() - began,
      } })
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

/**
 * 细层块的列用到哪些源采样帧 [from, to)：非负层每列汇总 2^level 个基础列（中心 i·512），负层每列一个窗（中心 c·hop）；
 * 两侧各放宽半个最长分析窗（文件外按零，不影响判断）。
 */
function spectralTileFrames(level: number, columnStart: number, columnCount: number): [number, number] {
  const half = spectralResolution(level).lowWindow / 2
  if (level >= 0) {
    const group = 2 ** level
    return [columnStart * group * 512 - half, ((columnStart + columnCount) * group - 1) * 512 + half]
  }
  const hop = spectralHop(level)
  return [columnStart * hop - half, (columnStart + columnCount - 1) * hop + half]
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
    await wait(verifyAudioEditSource(project, signal, 'quick'), signal)
    // 只有整文件摘要的素材，频谱键用那个身份对象（已算好的目录继续命中）；带采样指纹的（含重新定位过的旧作品）走内容键，
    // 原文件在未采样位置被改写、修改时间变了也会换键。
    const identity = project.source.identity && !project.source.fingerprint ? project.source.identity : await wait(audioEditSourceContentKey(project.source, signal), signal)
    const input = await wait(prepareInput(project.id, () => request.mode === 'edited' ? prepareAudioEditRenderSource(project) : prepareAudioEditAudio(project)), signal)
    const cache = audioEditSpectralCacheDirectory()
    const revision = request.mode === 'source' ? 0 : project.revision
    const keyFor = (mode: AudioEditSpectralTileRequest['mode'], file?: string): string => audioRenderKey(['spectral-pyramid-v1', identity, project.source.audioStreamIndex, project.source.sampleRate,
      project.source.channels, project.source.durationFrames, mode, mode === 'edited' ? path.basename(file!) : undefined])
    const key = keyFor(request.mode, input)
    const frames = project.source.durationFrames
    const metadata: SpectralMetadata = { sampleRate: project.source.sampleRate, channels: project.source.channels,
      durationFrames: frames, lowBins: spectralLowBins(project.source.sampleRate, request.level), highBins: spectralHighBins(request.level) }
    // 上一版可能是另一份编辑后声音、原素材的浮点副本（“什么都没改”的那一版），或补录拼接前的素材：先查“文件 → 频谱键”索引，
    // 还没有索引的旧目录按本作品当前的素材身份推算。
    const original = request.mode === 'edited' ? await wait(prepareAudioEditAudio(project), signal) : input
    const ancestorKey = async (ancestor: string): Promise<string> => await spectralKeyOf(cache, ancestor) ?? (ancestor === original ? keyFor('source') : keyFor('edited', ancestor))
    const deriveSource: DeriveSource = async () => {
      // 频谱进程不支持派生（可执行文件比主进程旧）就直接整段计算，不发它认不出的命令；长度不同的上一版也要它支持才用。
      const { deriveGroupLevel, deriveLengthChange } = await spectralWorker.capabilities()
      if (!deriveGroupLevel) return undefined
      const found = await findAudioLineageAncestor(input, async (ancestor, _dirty, ancestorFrames) => ancestorFrames === frames || deriveLengthChange ? completedDirectory(cache, await ancestorKey(ancestor)) : undefined)
      // 派生按组整组重算（一组的帧数即该层的 hop；改动波及两侧各半个长窗）：改动散布到一半以上的组时，整段计算一样快，还省一次复制。
      const groupFrames = spectralHop(deriveGroupLevel), half = spectralResolution(0).lowWindow / 2
      const groups = new Set<number>()
      const dirty = found && found.ancestorFrames !== frames ? [...found.dirty, [Math.min(found.ancestorFrames, frames), frames] as AudioLineageRange] : found?.dirty ?? []
      for (const [start, end] of dirty) {
        for (let group = Math.floor(Math.max(0, start - half) / groupFrames); group <= Math.floor((end + half) / groupFrames); group++) groups.add(group)
      }
      if (!found || groups.size * groupFrames > frames / 2) return undefined
      return { directory: found.value, dirty: found.dirty, hops: found.hops }
    }
    const directory = await wait(startBackground(cache, key, input, request, revision, deriveSource), signal)
    const base = { ...metadata, mode: request.mode, revision, level: request.level, tile: request.tile }
    if (request.level >= SPECTRAL_PERSISTED_MIN_LEVEL) {
      const data = await wait(readSpectralRange(directory, request.level, request.tile, metadata), signal)
      return { ...base, ...data }
    }
    const columnStart = request.tile * SPECTRAL_TILE_COLUMNS
    const columnCount = Math.min(SPECTRAL_TILE_COLUMNS, Math.max(0, spectralColumnCount(request.level, metadata.durationFrames) - columnStart))
    if (!columnCount) return { ...base, columnStart, columnCount, values: new Uint8Array(), complete: true }
    // 负层分析窗会随缩放变化，旧的固定窗块不得命中；整文件缓存与非负层保持原键。
    const tileKeyOf = (spectral: string): string => audioRenderKey(request.level < 0 ? [spectral, request.level, request.tile, 'adaptive-hann-v1', spectralResolution(request.level)] : [spectral, request.level, request.tile])
    // 这一块还没算过、而它用到的声音与上一版完全相同时，直接用上一版算好的块。
    const own = (await fs.stat(path.join(cache, `${tileKeyOf(key)}.rg`)).catch(() => null))?.size
    const reused = !own ? await wait(findAudioLineageAncestor(input, async (ancestor, dirty, ancestorFrames) => {
      const [from, to] = spectralTileFrames(request.level, columnStart, columnCount)
      // 长度不同的上一版：较短长度之后（含窗口伸出去的部分）都不能沿用。
      if (dirty.some(([start, end]) => start < to && end > from) || (ancestorFrames !== frames && to > Math.min(ancestorFrames, frames))) return undefined
      const file = path.join(cache, `${tileKeyOf(await ancestorKey(ancestor))}.rg`)
      return (await fs.stat(file).catch(() => null))?.size ? file : undefined
    }), signal) : undefined
    const file = reused?.value ?? await immediateFile(cache, tileKeyOf(key), input, request, metadata, signal)
    const bytes = await wait(fs.readFile(file), signal)
    void touchSpectralTile(file)
    scheduleTileTrim(cache)
    if (bytes.length !== metadata.channels * columnCount * (metadata.lowBins + metadata.highBins) * 2) throw new Error('频谱块缓存长度不匹配')
    return { ...base, columnStart, columnCount, complete: true, values: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
  } finally { requests.delete(request.requestId); release() }
}
