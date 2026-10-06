import fs from 'node:fs'
import path from 'node:path'

import type {
  LocalModelDownloadSource,
  LocalModelEnsureResult,
  LocalModelFailureCode,
  LocalModelId,
  LocalModelInfo,
  LocalModelProgress,
  LocalModelProgressEvent,
  LocalModelsState,
  LocalModelStatus,
} from '../../../../src/platform/contracts/localModels'
import type { MainLogger } from '../logging/main-logger'
import type { DownloadRegion, DownloadSourceSelector } from '../download/sourceSelector'
import { DownloadFailure, downloadVerifiedFile, verifyFile, type DownloadFetch } from '../download/verifiedDownload'
import { localModelSizeBytes, type LocalModelFileSpec, type LocalModelSource, type LocalModelSpec } from './manifest'

/*
 * 本地模型服务（任务 4.11）：列出状态、按需下载并校验、取消、删除、打开文件夹。
 *
 * - 模型文件夹：作品目录/模型/<模型名>/，里面是模型文件和一份说明（来源、许可证、校验值）。
 * - 读取前校验：每个文件按清单的大小与 SHA-256 核对；同一文件大小和修改时间没变时复用上次结果，
 *   不重复计算。
 * - 同一模型的并发 ensure 共用一次下载；取消后保留已下载部分，下次续传。
 * - 下载源顺序由通用的下载源选择决定，同一区域内按清单顺序尝试，全部失败才报错。
 *
 * 依赖全部注入，测试不碰网络与 Electron。
 */

export interface LocalModelServiceDeps {
  manifest: readonly LocalModelSpec[]
  modelsLocation: () => { dir: string; locale: 'zh' | 'en' }
  selector: DownloadSourceSelector
  fetch: DownloadFetch
  readPreference: () => LocalModelDownloadSource
  writePreference: (source: LocalModelDownloadSource) => void
  emit: (event: LocalModelProgressEvent) => void
  /** 打开文件夹；返回错误信息，成功为空字符串（同 Electron shell.openPath）。 */
  openPath: (dir: string) => Promise<string>
  logger: MainLogger
  now?: () => number
  /** 两次进度推送的最小间隔。 */
  progressIntervalMs?: number
}

export class LocalModelError extends Error {
  constructor(readonly code: LocalModelFailureCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'LocalModelError'
  }
}

interface ActiveDownload {
  controller: AbortController
  promise: Promise<LocalModelEnsureResult>
  progress: LocalModelProgress
}

const DESCRIPTION_FILE_NAMES = { zh: '说明.txt', en: 'README.txt' } as const
const ATTEMPTS_PER_SOURCE = 2

export class LocalModelService {
  private readonly active = new Map<LocalModelId, ActiveDownload>()
  private readonly failures = new Map<LocalModelId, LocalModelFailureCode>()
  /** 已校验通过的文件：路径 → `大小:修改时间`。 */
  private readonly verified = new Map<string, string>()
  private readonly now: () => number
  private revision = 1

  constructor(private readonly deps: LocalModelServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  private spec(id: LocalModelId): LocalModelSpec {
    const spec = this.deps.manifest.find((item) => item.id === id)
    if (!spec) throw new LocalModelError('unavailable', `清单里没有 ${id}`)
    return spec
  }

  private modelDir(spec: LocalModelSpec): { dir: string; locale: 'zh' | 'en' } {
    const location = this.deps.modelsLocation()
    return { dir: path.join(location.dir, spec.folderName[location.locale]), locale: location.locale }
  }

  hasActiveDownloads(): boolean {
    return this.active.size > 0
  }

  getDownloadSource(): LocalModelDownloadSource {
    return this.deps.readPreference()
  }

  setDownloadSource(source: LocalModelDownloadSource): void {
    if (this.deps.readPreference() === source) return
    this.deps.writePreference(source)
    this.revision += 1
    this.deps.logger.info('本地模型下载源已更改', { event: 'local_models.source.changed', context: { source } })
  }

  private async fileState(filePath: string, file: LocalModelFileSpec): Promise<'ok' | 'missing' | 'mismatch'> {
    let stamp: string
    try {
      const stat = await fs.promises.stat(filePath)
      stamp = `${stat.size}:${stat.mtimeMs}`
    } catch {
      this.verified.delete(filePath)
      return 'missing'
    }
    if (this.verified.get(filePath) === stamp) return 'ok'
    const result = await verifyFile(filePath, file)
    if (result === 'ok') this.verified.set(filePath, stamp)
    else this.verified.delete(filePath)
    return result
  }

  private async diskStatus(spec: LocalModelSpec): Promise<Exclude<LocalModelStatus, 'downloading'>> {
    if (spec.availability === 'pending' || spec.files.length === 0) return 'unavailable'
    const { dir } = this.modelDir(spec)
    const states = await Promise.all(spec.files.map((file) => this.fileState(path.join(dir, file.name), file)))
    if (states.every((state) => state === 'ok')) return 'ready'
    if (states.every((state) => state === 'missing')) return 'not_downloaded'
    return 'corrupt'
  }

  async info(id: LocalModelId): Promise<LocalModelInfo> {
    const spec = this.spec(id)
    const active = this.active.get(id)
    return {
      id,
      title: spec.title,
      purpose: spec.purpose,
      license: spec.license.spdx,
      sizeBytes: localModelSizeBytes(spec),
      status: active ? 'downloading' : await this.diskStatus(spec),
      progress: active ? { ...active.progress } : null,
      lastFailure: this.failures.get(id) ?? null,
    }
  }

  async list(): Promise<LocalModelInfo[]> {
    return Promise.all(this.deps.manifest.map((spec) => this.info(spec.id)))
  }

  async getState(): Promise<LocalModelsState> {
    const models = await this.list()
    return { revision: this.revision, downloadSource: this.deps.readPreference(), models }
  }

  private location(spec: LocalModelSpec): LocalModelEnsureResult {
    const { dir } = this.modelDir(spec)
    return {
      id: spec.id,
      directory: dir,
      files: spec.files.map((file) => ({ name: file.name, role: file.role, path: path.join(dir, file.name) })),
    }
  }

  private emit(id: LocalModelId, status: LocalModelStatus, progress: LocalModelProgress | null): void {
    // 进行中的进度不算状态变化；开始、结束、删除才推进修订号。
    if (status !== 'downloading' || progress?.receivedBytes === 0) this.revision += 1
    this.deps.emit({ id, status, progress, lastFailure: this.failures.get(id) ?? null })
  }

  /** 已就绪直接返回位置；否则下载并校验。同一模型的并发调用共用一次下载。 */
  async ensure(id: LocalModelId): Promise<LocalModelEnsureResult> {
    const running = this.active.get(id)
    if (running) return running.promise
    const spec = this.spec(id)
    if (spec.availability === 'pending' || spec.files.length === 0) {
      throw new LocalModelError('unavailable', `${spec.title.zh} 暂时没有可下载的文件`)
    }
    if (await this.diskStatus(spec) === 'ready') return this.location(spec)
    // 校验期间可能已有另一调用开始下载。
    const raced = this.active.get(id)
    if (raced) return raced.promise

    const controller = new AbortController()
    const progress: LocalModelProgress = { receivedBytes: 0, totalBytes: localModelSizeBytes(spec) }
    const promise = this.runDownload(spec, controller, progress).finally(() => {
      if (this.active.get(id) === download) this.active.delete(id)
    })
    const download: ActiveDownload = { controller, progress, promise }
    this.active.set(id, download)
    this.failures.delete(id)
    this.emit(id, 'downloading', { ...progress })
    try {
      const result = await download.promise
      this.emit(id, 'ready', null)
      return result
    } catch (error) {
      const code = error instanceof LocalModelError ? error.code : 'network'
      this.failures.set(id, code)
      this.emit(id, await this.diskStatus(spec), null)
      throw error instanceof LocalModelError ? error : new LocalModelError(code, (error as Error).message)
    }
  }

  private orderedSources(file: LocalModelFileSpec, regions: readonly DownloadRegion[]): LocalModelSource[] {
    return regions.flatMap((region) => file.sources.filter((source) => source.region === region))
  }

  private async runDownload(spec: LocalModelSpec, controller: AbortController, progress: LocalModelProgress): Promise<LocalModelEnsureResult> {
    const startedAt = this.now()
    const { dir, locale } = this.modelDir(spec)
    const preference = this.deps.readPreference()
    const regions = await this.deps.selector.order(preference)
    const requestId = `local-model-${spec.id}-${startedAt}`
    this.deps.logger.info('开始下载本地模型', {
      event: 'local_models.download.start', requestId, modelId: spec.id,
      context: { preference, regions, totalBytes: progress.totalBytes },
    })

    const received = new Map<string, number>()
    let lastEmit = 0
    const report = (fileName: string, bytes: number): void => {
      received.set(fileName, bytes)
      progress.receivedBytes = [...received.values()].reduce((sum, value) => sum + value, 0)
      const now = this.now()
      if (now - lastEmit >= (this.deps.progressIntervalMs ?? 150)) {
        lastEmit = now
        this.emit(spec.id, 'downloading', { ...progress })
      }
    }

    const usedSources: Record<string, string> = {}
    try {
      for (const file of spec.files) {
        const destination = path.join(dir, file.name)
        if (await this.fileState(destination, file) === 'ok') {
          report(file.name, file.sizeBytes)
          continue
        }
        usedSources[file.name] = await this.downloadFile(spec, file, destination, regions, controller.signal, requestId, (bytes) => report(file.name, bytes))
      }
      await this.writeDescription(spec, dir, locale, usedSources)
    } catch (error) {
      const failure = error instanceof LocalModelError ? error : new LocalModelError('disk', (error as Error).message)
      const level = failure.code === 'cancelled' ? 'info' : 'error'
      this.deps.logger[level]('本地模型下载未完成', {
        event: failure.code === 'cancelled' ? 'local_models.download.cancelled' : 'local_models.download.failed',
        requestId, modelId: spec.id,
        context: { code: failure.code, durationMs: this.now() - startedAt, receivedBytes: progress.receivedBytes },
        error: failure.code === 'cancelled' ? undefined : failure,
      })
      throw failure
    }
    this.deps.logger.info('本地模型下载完成', {
      event: 'local_models.download.completed', requestId, modelId: spec.id,
      context: { durationMs: this.now() - startedAt, sources: usedSources },
    })
    return this.location(spec)
  }

  /** 依次尝试各个源，返回成功的源标签。 */
  private async downloadFile(
    spec: LocalModelSpec,
    file: LocalModelFileSpec,
    destination: string,
    regions: readonly DownloadRegion[],
    signal: AbortSignal,
    requestId: string,
    onProgress: (bytes: number) => void,
  ): Promise<string> {
    let lastKind: DownloadFailure['kind'] | null = null
    for (const source of this.orderedSources(file, regions)) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_SOURCE; attempt += 1) {
        if (signal.aborted) throw new LocalModelError('cancelled', '下载已取消')
        try {
          const result = await downloadVerifiedFile({
            url: source.url, destination, spec: file, fetch: this.deps.fetch,
            signal, onProgress,
          })
          this.verified.delete(destination)
          this.deps.logger.debug('本地模型文件已下载并校验', {
            event: 'local_models.file.completed', requestId, modelId: spec.id,
            context: { file: file.name, source: source.label, region: source.region, attempt, ...result },
          })
          return source.label
        } catch (error) {
          const failure = error instanceof DownloadFailure ? error : new DownloadFailure('network', (error as Error).message)
          if (failure.kind === 'cancelled') throw new LocalModelError('cancelled', '下载已取消')
          if (failure.kind === 'disk') throw new LocalModelError('disk', failure.message)
          lastKind = failure.kind === 'checksum' || lastKind === 'checksum' ? 'checksum' : failure.kind
          onProgress(0)
          this.deps.logger.warn(failure.kind === 'checksum' ? '下载源的文件与清单校验值不一致' : '下载源不可用，尝试下一个', {
            event: failure.kind === 'checksum' ? 'local_models.source.checksum_mismatch' : 'local_models.source.failed',
            requestId, modelId: spec.id,
            context: { file: file.name, source: source.label, region: source.region, attempt, kind: failure.kind, status: failure.status, message: failure.message },
          })
          if (source.region === regions[0]) this.deps.selector.reportFailure(source.region)
          // 只有网络中断值得在同一个源续传重试；HTTP 错误（如仓库还不存在的 404）与校验不符直接换源。
          if (failure.kind !== 'network') break
        }
      }
    }
    throw new LocalModelError(lastKind === 'checksum' ? 'checksum' : 'network', `${file.name} 所有下载源都失败了`)
  }

  private async writeDescription(spec: LocalModelSpec, dir: string, locale: 'zh' | 'en', usedSources: Record<string, string>): Promise<void> {
    const urlOf = (file: LocalModelFileSpec): string => {
      const label = usedSources[file.name]
      return file.sources.find((source) => source.label === label)?.url ?? file.sources[0]?.url ?? ''
    }
    const date = new Date(this.now()).toISOString()
    const lines = locale === 'zh'
      ? [
        spec.title.zh, '',
        `用途：${spec.purpose.zh}`,
        `来源：${spec.homepage}`,
        `许可证：${spec.license.spdx}（${spec.license.url}）`,
        `下载时间：${date}`, '',
        '文件：',
        ...spec.files.flatMap((file) => [`  ${file.name}`, `    大小：${file.sizeBytes} 字节`, `    SHA-256：${file.sha256}`, `    下载地址：${urlOf(file)}`]),
        '',
        '此文件夹由痕迹AI 管理。可以整个删除，需要时会重新下载；请不要修改其中的文件，否则校验不通过需要重新下载。',
      ]
      : [
        spec.title.en, '',
        `Purpose: ${spec.purpose.en}`,
        `Source: ${spec.homepage}`,
        `License: ${spec.license.spdx} (${spec.license.url})`,
        `Downloaded: ${date}`, '',
        'Files:',
        ...spec.files.flatMap((file) => [`  ${file.name}`, `    Size: ${file.sizeBytes} bytes`, `    SHA-256: ${file.sha256}`, `    URL: ${urlOf(file)}`]),
        '',
        'This folder is managed by Henji AI. You can delete it; it will be downloaded again when needed. Do not modify the files, or verification will fail.',
      ]
    try {
      await fs.promises.writeFile(path.join(dir, DESCRIPTION_FILE_NAMES[locale]), `${lines.join('\n')}\n`, 'utf8')
    } catch (error) {
      // 说明文件写不进去不影响模型可用，只记日志。
      this.deps.logger.warn('写入本地模型说明文件失败', { event: 'local_models.description.failed', modelId: spec.id, error })
    }
  }

  /** 取消进行中的下载；已下载部分保留。返回是否有可取消的下载。 */
  async cancel(id: LocalModelId): Promise<boolean> {
    const active = this.active.get(id)
    if (!active) return false
    active.controller.abort()
    // 与删除的取消屏障一致：等原下载释放文件并发布最终状态，再让 UI/助手回读。
    await active.promise.catch(() => undefined)
    return true
  }

  /** 删除本地文件；正在下载时先取消并等它结束。 */
  async remove(id: LocalModelId): Promise<void> {
    const spec = this.spec(id)
    const active = this.active.get(id)
    if (active) {
      active.controller.abort()
      await active.promise.catch(() => undefined)
    }
    const { dir } = this.modelDir(spec)
    try {
      await fs.promises.rm(dir, { recursive: true, force: true })
    } catch (error) {
      this.deps.logger.error('删除本地模型失败', { event: 'local_models.remove.failed', modelId: id, error })
      throw new LocalModelError('disk', (error as Error).message)
    }
    for (const file of spec.files) this.verified.delete(path.join(dir, file.name))
    this.failures.delete(id)
    this.deps.logger.info('已删除本地模型', { event: 'local_models.remove.completed', modelId: id })
    this.emit(id, await this.diskStatus(spec), null)
  }

  /** 打开模型文件夹；模型还没下载时打开“模型”总文件夹。 */
  async openFolder(id: LocalModelId | null): Promise<void> {
    const root = this.deps.modelsLocation().dir
    let target = root
    if (id) {
      const { dir } = this.modelDir(this.spec(id))
      if (fs.existsSync(dir)) target = dir
    }
    await fs.promises.mkdir(target, { recursive: true })
    const message = await this.deps.openPath(target)
    if (message) {
      this.deps.logger.warn('打开本地模型文件夹失败', { event: 'local_models.open_folder.failed', modelId: id ?? undefined, context: { message } })
      throw new Error(message)
    }
  }

  /** 退出时取消全部下载（保留已下载部分）。 */
  dispose(): void {
    for (const active of this.active.values()) active.controller.abort()
  }
}
