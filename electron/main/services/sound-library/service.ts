import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseSoundName, soundFolderTerms } from '../../../../src/core/soundLibrary/soundName'
import { normalizeEmbedding } from '../../../../src/core/soundLibrary/clapFeatures'
import type { SoundFeatures } from '../../../../src/core/soundLibrary/soundFeatures'
import { searchSoundIndex, type SoundIndexEntry } from '../../../../src/core/soundLibrary/soundSearch'
import type { SoundLibraryFolderRecord } from '../../../../src/core/soundLibrary/soundLibraryFolders'
import type {
  SoundLibraryFolderInfo, SoundLibraryListeningUse, SoundLibrarySearchRequest, SoundLibrarySearchResponse,
  SoundLibrarySkippedFile, SoundLibrarySoundLocation, SoundLibrarySoundPage, SoundLibrarySoundSummary, SoundLibraryState,
} from '../../../../src/platform/contracts/soundLibrary'
import type { ContentDiskCache } from '../media/content-disk-cache'
import type { SoundAnalysisFileResult, SoundAnalysisResult, SoundClapModels } from '../local-inference/sound/protocol'
import { scanSoundFolder, type ScannedSoundFile } from './scan'

/*
 * 音效库（主进程）：登记文件夹、增量整理与检索。
 *
 * 每个文件的分析结果按“分析版本 + 路径 + 大小 + 修改时间”存进磁盘缓存（坏文件的失败原因也缓存，不反复解码），
 * 内存里保留当前索引；只有第一次整理慢。听音模型下载后，缺向量的条目在下一次整理时补算。
 * 解码、测量与推理都在本地推理后台进程里进行，这里只协调。
 */

/** 改动测量算法或缓存结构时加一，旧缓存自然失效（缓存可重建，不是用户数据）。 */
export const SOUND_ANALYSIS_VERSION = 1
const ANALYSIS_BATCH = 32
const CLAP_MODEL_TAG = 'larger_clap_general_fp16'

interface CachedAnalysis { v: number; size: number; mtimeMs: number; result: { ok: true; features: SoundFeatures; embedding?: string; embeddingModel?: string } | { ok: false; reason: string } }

interface IndexedFile { scanned: ScannedSoundFile; entry?: SoundIndexEntry; skipped?: string }

interface FolderState {
  record: SoundLibraryFolderRecord
  files: Map<string, IndexedFile>
  status: SoundLibraryFolderInfo['status']
  progress: SoundLibraryFolderInfo['progress']
  indexedAt: string | null
  lastError: string | null
  refreshing?: Promise<void>
}

export interface SoundLibraryServiceDeps {
  readFolders(): Promise<SoundLibraryFolderRecord[]>
  writeFolders(folders: SoundLibraryFolderRecord[]): Promise<void>
  chooseFolder(): Promise<string | null>
  analyze(files: string[], clap: SoundClapModels | null, progress: (done: number, total: number) => void): Promise<SoundAnalysisResult>
  embedText(clap: SoundClapModels, texts: string[]): Promise<number[][]>
  /** 听音模型已下载时返回文件位置；未下载返回 null（不自动下载）。 */
  clapModels(): Promise<SoundClapModels | null>
  cache: ContentDiskCache | null
  emit(state: SoundLibraryState): void
  log(level: 'info' | 'warn' | 'error', message: string, event: string, context: Record<string, unknown>, error?: unknown): void
}

export class SoundLibraryError extends Error {
  constructor(message: string) { super(message); this.name = 'SoundLibraryError' }
}

function cacheKey(file: ScannedSoundFile): string {
  const normalized = process.platform === 'win32' ? file.path.toLowerCase() : file.path
  return createHash('sha256').update(`${SOUND_ANALYSIS_VERSION}\0${normalized}\0${file.size}\0${file.mtimeMs}`).digest('hex')
}

function soundId(folderId: string, relativePath: string): string {
  return `${folderId}:${createHash('sha256').update(relativePath).digest('hex').slice(0, 16)}`
}

function encodeEmbedding(values: ArrayLike<number>): string {
  return Buffer.from(Float32Array.from(values).buffer).toString('base64')
}
function decodeEmbedding(text: string): Float32Array | undefined {
  const bytes = Buffer.from(text, 'base64')
  if (bytes.byteLength !== 512 * 4) return undefined
  const aligned = new Uint8Array(bytes.byteLength); aligned.set(bytes)
  return new Float32Array(aligned.buffer)
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left), b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export class SoundLibraryService {
  private readonly folders = new Map<string, FolderState>()
  private loaded?: Promise<void>
  private revision = 0
  private listeningReady = false

  constructor(private readonly deps: SoundLibraryServiceDeps) {}

  private load(): Promise<void> {
    this.loaded ??= this.deps.readFolders().then(records => {
      for (const record of records) this.folders.set(record.id, { record, files: new Map(), status: 'not_indexed', progress: null, indexedAt: null, lastError: null })
    }).catch(error => { this.loaded = undefined; throw error })
    return this.loaded
  }

  private info(state: FolderState): SoundLibraryFolderInfo {
    const entries = [...state.files.values()]
    const skipped: SoundLibrarySkippedFile[] = entries.flatMap(file => file.skipped ? [{ relativePath: file.scanned.relativePath, reason: file.skipped }] : [])
    return {
      id: state.record.id, name: path.basename(state.record.path) || state.record.path, path: state.record.path, status: state.status,
      soundCount: entries.filter(file => file.entry).length, listeningCount: entries.filter(file => file.entry?.embedding).length,
      skipped, progress: state.progress, indexedAt: state.indexedAt, lastError: state.lastError,
    }
  }

  private snapshot(): SoundLibraryState {
    return { revision: this.revision, folders: [...this.folders.values()].map(state => this.info(state)), listeningModelReady: this.listeningReady }
  }

  private publish(): void { this.revision++; this.deps.emit(this.snapshot()) }

  async getState(): Promise<SoundLibraryState> {
    await this.load()
    this.listeningReady = (await this.deps.clapModels().catch(() => null)) !== null
    return this.snapshot()
  }

  async addFolder(): Promise<SoundLibraryFolderInfo | null> {
    await this.load()
    const chosen = await this.deps.chooseFolder()
    if (!chosen) return null
    const existing = [...this.folders.values()].find(state => samePath(state.record.path, chosen))
    if (existing) return this.info(existing)
    if (!(await fs.stat(chosen).catch(() => null))?.isDirectory()) throw new SoundLibraryError('选择的位置不是文件夹。')
    const record: SoundLibraryFolderRecord = { id: randomUUID(), path: path.resolve(chosen), addedAt: new Date().toISOString() }
    await this.deps.writeFolders([...[...this.folders.values()].map(state => state.record), record])
    const state: FolderState = { record, files: new Map(), status: 'not_indexed', progress: null, indexedAt: null, lastError: null }
    this.folders.set(record.id, state)
    this.deps.log('info', '已登记音效文件夹', 'sound_library.folder.added', { folderId: record.id })
    this.publish()
    // 登记后立即在后台整理；检索时会等待同一次整理。
    void this.refreshFolder(state).catch(() => undefined)
    return this.info(state)
  }

  async removeFolder(id: string): Promise<boolean> {
    await this.load()
    if (!this.folders.has(id)) return false
    await this.deps.writeFolders([...this.folders.values()].filter(state => state.record.id !== id).map(state => state.record))
    this.folders.delete(id)
    this.deps.log('info', '已移除音效文件夹', 'sound_library.folder.removed', { folderId: id })
    this.publish()
    return true
  }

  private requireFolders(ids?: readonly string[]): FolderState[] {
    if (!ids?.length) return [...this.folders.values()]
    return ids.map(id => {
      const state = this.folders.get(id)
      if (!state) throw new SoundLibraryError(`没有这个音效文件夹：${id}。已登记的有 ${[...this.folders.values()].map(value => `${value.record.id}（${path.basename(value.record.path)}）`).join('、') || '（无）'}`)
      return state
    })
  }

  async refresh(ids?: readonly string[]): Promise<SoundLibraryState> {
    await this.load()
    const states = this.requireFolders(ids)
    await Promise.all(states.map(state => this.refreshFolder(state)))
    return this.snapshot()
  }

  private refreshFolder(state: FolderState): Promise<void> {
    state.refreshing ??= this.runRefresh(state).finally(() => { state.refreshing = undefined })
    return state.refreshing
  }

  private async readCached(file: ScannedSoundFile): Promise<CachedAnalysis['result'] | undefined> {
    const bytes = await this.deps.cache?.read(cacheKey(file)).catch(() => undefined)
    if (!bytes) return undefined
    try {
      const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as CachedAnalysis
      return value.v === SOUND_ANALYSIS_VERSION && value.size === file.size && value.mtimeMs === file.mtimeMs ? value.result : undefined
    } catch { await this.deps.cache?.remove(cacheKey(file)).catch(() => undefined); return undefined }
  }

  private entryOf(state: FolderState, file: ScannedSoundFile, features: SoundFeatures, embedding?: Float32Array): SoundIndexEntry {
    const name = parseSoundName(path.basename(file.relativePath))
    const directory = path.posix.dirname(file.relativePath)
    return { id: soundId(state.record.id, file.relativePath), folderId: state.record.id, relativePath: file.relativePath, ...name, folderTerms: [path.basename(state.record.path), ...soundFolderTerms(directory === '.' ? '' : directory)], features, ...(embedding ? { embedding } : {}) }
  }

  private async runRefresh(state: FolderState): Promise<void> {
    const started = Date.now()
    state.status = 'indexing'; state.lastError = null; state.progress = { done: 0, total: 0 }; this.publish()
    this.deps.log('info', '音效文件夹整理开始', 'sound_library.index.start', { folderId: state.record.id })
    try {
      const scanned = await scanSoundFolder(state.record.path)
      const clap = await this.deps.clapModels().catch(() => null)
      this.listeningReady = clap !== null
      const next = new Map<string, IndexedFile>()
      const pending: ScannedSoundFile[] = []
      let fromCache = 0
      for (const file of scanned) {
        const known = state.files.get(file.relativePath)
        const current = known && known.scanned.size === file.size && known.scanned.mtimeMs === file.mtimeMs && known.scanned.path === file.path
        if (current && (known.skipped || !clap || known.entry?.embedding || known.entry?.features.peakDbfs === null)) { next.set(file.relativePath, known); continue }
        const cached = await this.readCached(file)
        if (cached && !cached.ok) { next.set(file.relativePath, { scanned: file, skipped: cached.reason }); fromCache++; continue }
        if (cached?.ok) {
          const embedding = cached.embedding && cached.embeddingModel === CLAP_MODEL_TAG ? decodeEmbedding(cached.embedding) : undefined
          next.set(file.relativePath, { scanned: file, entry: this.entryOf(state, file, cached.features, embedding) })
          fromCache++
          if (!clap || embedding || cached.features.peakDbfs === null) continue
        }
        pending.push(file)
      }
      state.files = next
      state.progress = { done: 0, total: pending.length }; this.publish()
      let analysis = { decodeMs: 0, inferenceMs: 0, provider: null as string | null }
      for (let offset = 0; offset < pending.length; offset += ANALYSIS_BATCH) {
        const batch = pending.slice(offset, offset + ANALYSIS_BATCH)
        const result = await this.deps.analyze(batch.map(file => file.path), clap, done => { state.progress = { done: offset + done, total: pending.length }; this.publish() })
        analysis = { decodeMs: analysis.decodeMs + result.decodeMs, inferenceMs: analysis.inferenceMs + result.inferenceMs, provider: result.provider ?? analysis.provider }
        await Promise.all(batch.map((file, index) => this.adopt(state, file, result.files[index])))
      }
      state.status = 'ready'; state.indexedAt = new Date().toISOString(); state.progress = null
      const info = this.info(state)
      this.deps.log('info', '音效文件夹整理完成', 'sound_library.index.completed', { folderId: state.record.id, files: scanned.length, sounds: info.soundCount, listening: info.listeningCount, skipped: info.skipped.length, fromCache, analyzed: pending.length, ...analysis, durationMs: Date.now() - started })
    } catch (error) {
      state.status = 'failed'; state.progress = null
      state.lastError = error instanceof Error && error.name === 'SoundLibraryScanError' ? error.message : '整理音效文件夹失败，请重试。'
      this.deps.log('error', '音效文件夹整理失败', 'sound_library.index.failed', { folderId: state.record.id, durationMs: Date.now() - started }, error)
      throw error
    } finally { this.publish() }
  }

  private async adopt(state: FolderState, file: ScannedSoundFile, result: SoundAnalysisFileResult | undefined): Promise<void> {
    if (!result) return
    const embedding = result.ok && result.embedding ? normalizeEmbedding(result.embedding) : undefined
    const previous = state.files.get(file.relativePath)?.entry
    const kept = embedding ?? previous?.embedding
    state.files.set(file.relativePath, result.ok ? { scanned: file, entry: this.entryOf(state, file, result.features, kept) } : { scanned: file, skipped: result.reason })
    const cached: CachedAnalysis = { v: SOUND_ANALYSIS_VERSION, size: file.size, mtimeMs: file.mtimeMs, result: result.ok ? { ok: true, features: result.features, ...(kept ? { embedding: encodeEmbedding(kept), embeddingModel: CLAP_MODEL_TAG } : {}) } : { ok: false, reason: result.reason } }
    await this.deps.cache?.write(cacheKey(file), new TextEncoder().encode(JSON.stringify(cached))).catch(error => this.deps.log('warn', '音效分析缓存写入失败', 'sound_library.cache.write_failed', {}, error))
  }

  async search(request: SoundLibrarySearchRequest): Promise<SoundLibrarySearchResponse> {
    await this.load()
    const states = this.requireFolders(request.folderIds)
    if (!states.length) throw new SoundLibraryError('还没有登记音效文件夹。请先登记一个音效文件夹（会打开文件夹选择框，由用户选择）。')
    await Promise.all(states.map(state => this.refreshFolder(state)))
    const entries = states.flatMap(state => [...state.files.values()].flatMap(file => file.entry ? [file.entry] : []))
    const clap = request.description?.trim() ? await this.deps.clapModels().catch(() => null) : null
    let listening: SoundLibraryListeningUse = !request.description?.trim() ? 'no_description' : clap ? 'used' : 'model_not_downloaded'
    const descriptionEmbedding = clap ? normalizeEmbedding((await this.deps.embedText(clap, [request.description!.trim()]))[0]) : undefined
    if (descriptionEmbedding && entries.some(entry => !entry.embedding && entry.features.peakDbfs !== null)) listening = 'partial'
    const result = searchSoundIndex(entries, { keywords: request.keywords, ...(descriptionEmbedding ? { descriptionEmbedding } : {}), minDurationSeconds: request.minDurationSeconds, maxDurationSeconds: request.maxDurationSeconds, maxHitSeconds: request.maxHitSeconds, brightness: request.brightness, limit: request.limit })
    const response: SoundLibrarySearchResponse = {
      matches: result.hits.map(hit => ({ id: hit.entry.id, folderId: hit.entry.folderId, relativePath: hit.entry.relativePath, label: hit.entry.label, english: hit.entry.english, chinese: hit.entry.chinese, ...hit.entry.features, score: hit.score, nameScore: hit.nameScore, listenScore: hit.listenScore, matchedBy: hit.matchedBy })),
      noGoodMatch: result.noGoodMatch, considered: result.considered, listening, indexedSounds: entries.length,
      skippedFiles: states.reduce((sum, state) => sum + [...state.files.values()].filter(file => file.skipped).length, 0),
    }
    this.deps.log('info', '音效检索完成', 'sound_library.search.completed', { folders: states.length, keywords: request.keywords.length, listening, matches: response.matches.length, noGoodMatch: response.noGoodMatch })
    return response
  }

  private summary(entry: SoundIndexEntry): SoundLibrarySoundSummary {
    return { id: entry.id, folderId: entry.folderId, relativePath: entry.relativePath, label: entry.label, english: entry.english, chinese: entry.chinese, features: entry.features, hasListening: Boolean(entry.embedding) }
  }

  async listSounds(offset: number, limit: number): Promise<SoundLibrarySoundPage> {
    await this.load()
    await Promise.all([...this.folders.values()].filter(state => state.status !== 'ready').map(state => this.refreshFolder(state).catch(() => undefined)))
    const entries = [...this.folders.values()].flatMap(state => [...state.files.values()].flatMap(file => file.entry ? [file.entry] : []))
    return { sounds: entries.slice(offset, offset + limit).map(entry => this.summary(entry)), total: entries.length, revision: this.revision }
  }

  async locate(id: string): Promise<SoundLibrarySoundLocation> {
    await this.load()
    const state = this.folders.get(id.split(':')[0])
    // 重启后内存索引为空：先整理（命中缓存很快）再定位。
    if (state && state.status !== 'ready') await this.refreshFolder(state)
    const file = state && [...state.files.values()].find(value => value.entry?.id === id)
    if (!state || !file?.entry) throw new SoundLibraryError('这个音效已不在登记的文件夹里，请重新检索。')
    return { ...this.summary(file.entry), path: file.scanned.path }
  }
}
