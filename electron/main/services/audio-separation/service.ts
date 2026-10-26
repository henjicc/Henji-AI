import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { LocalExecutionProvider } from '../local-inference/providers'
import type { AudioSeparationJob, AudioSeparationJobResult, AudioSeparationMode } from '../local-inference/separation/protocol'
import { parseFloat32WavHeader } from '../local-inference/separation/wav'
import type { ContentDiskCache } from '../media/content-disk-cache'
import type { MediaContentIdentity } from '../media/content-identity'
import { SharedMediaAnalysis } from '../media/shared-analysis'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'

/*
 * 人声分离 / 去混响服务（主进程）：按“素材内容身份 + 方式 + 模型 SHA-256”缓存两个结果 WAV（媒体缓存的“分析”分类，可重建）；
 * 命中直接返回，同一素材同一方式的并发请求共用一次计算。模型第一次用到时自动下载（各约 67 MB）。
 * 后台进程把结果写进缓存目录里本次作业独占的临时目录，完成后逐个改名进缓存，临时目录随即删除。
 */

/** 前后处理或输出格式变化时加一，旧缓存自然失效。 */
export const AUDIO_SEPARATION_CACHE_VERSION = 1

export interface AudioSeparationResult {
  /** vocals：人声；dereverb：去混响后的干声。 */
  primaryPath: string
  /** 原声 − 主分量：伴奏 / 混响。 */
  residualPath: string
  sampleRate: number
  channels: number
  cached: boolean
  /** 本次实际推理用的执行提供者；命中缓存时为 null。 */
  provider: LocalExecutionProvider | null
}

export type AudioSeparationRun = Pick<AudioSeparationJob, 'source' | 'mode' | 'modelPath' | 'outputDirectory'>

export interface AudioSeparationServiceDependencies {
  /** 扩展名 `.wav` 的内容缓存。 */
  cache: ContentDiskCache
  identify(source: string): Promise<MediaContentIdentity>
  /** 清单里登记的模型 SHA-256（进缓存键；不触发下载）。 */
  modelSha256(mode: AudioSeparationMode): string
  /** 确保模型可用（可能触发下载），返回模型文件路径。 */
  ensureModel(mode: AudioSeparationMode): Promise<string>
  run(request: AudioSeparationRun, signal: AbortSignal, progress: (value: number) => void): Promise<AudioSeparationJobResult>
  log(level: 'info' | 'warn', message: string, event: string, context: Record<string, unknown>): void
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

async function readWavFormat(file: string): Promise<{ sampleRate: number; channels: number }> {
  const handle = await fs.open(file, 'r')
  try {
    const head = new Uint8Array(512)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    const header = parseFloat32WavHeader(head.subarray(0, bytesRead))
    if (!header) throw new Error('WAV 文件头不完整。')
    return { sampleRate: header.sampleRate, channels: header.channels }
  } finally { await handle.close() }
}

export class AudioSeparationService {
  private readonly shared = new SharedMediaAnalysis<AudioSeparationResult>()
  private active = 0
  constructor(private readonly deps: AudioSeparationServiceDependencies) {}

  hasActiveJobs(): boolean { return this.active > 0 }

  private keys(mode: AudioSeparationMode, identity: string): { base: string; primary: string; residual: string } {
    const base = sha256(`audio-separation-v${AUDIO_SEPARATION_CACHE_VERSION}:${mode}:${this.deps.modelSha256(mode)}:${identity}`)
    return { base, primary: sha256(`${base}:primary`), residual: sha256(`${base}:residual`) }
  }

  private async cached(keys: { primary: string; residual: string }): Promise<AudioSeparationResult | undefined> {
    const [primaryPath, residualPath] = await Promise.all([this.deps.cache.locate(keys.primary), this.deps.cache.locate(keys.residual)])
    if (!primaryPath || !residualPath) return undefined
    try {
      const [format, other] = await Promise.all([readWavFormat(primaryPath), readWavFormat(residualPath)])
      if (format.sampleRate !== other.sampleRate || format.channels !== other.channels) throw new Error('两个结果的格式不一致。')
      return { primaryPath, residualPath, ...format, cached: true, provider: null }
    } catch (error) {
      this.deps.log('warn', '人声分离缓存无效，已丢弃', 'audio_separation.cache.invalid', { reason: error instanceof Error ? error.message.slice(0, 200) : String(error) })
      await Promise.all([this.deps.cache.remove(keys.primary), this.deps.cache.remove(keys.residual)])
      return undefined
    }
  }

  /** 把后台进程写好的文件改名进缓存（同一目录内两次改名，不复制）。 */
  private async adopt(key: string, file: string): Promise<string> {
    const temporary = await this.deps.cache.prepareTemporary(key)
    if (!temporary) throw new Error('缓存目录不可用，无法保存分离结果。')
    await fs.rename(file, temporary)
    return this.deps.cache.adopt(key, temporary)
  }

  async separate(source: string, mode: AudioSeparationMode, signal: AbortSignal, progress: (value: number) => void = () => undefined): Promise<AudioSeparationResult> {
    signal.throwIfAborted()
    const content = await this.deps.identify(source)
    const keys = this.keys(mode, content.identity)
    const hit = await this.cached(keys)
    if (hit) {
      this.deps.log('info', '人声分离命中缓存', 'audio_separation.cache.hit', { mode })
      return hit
    }
    return this.shared.run(keys.base, async (sharedSignal, report) => {
      const started = Date.now()
      // 按计算计数（不按调用方）：调用方取消离开后，后台进程收尾期间仍算在忙。
      this.active++
      this.deps.log('info', '人声分离开始', 'audio_separation.job.started', { mode })
      let directory: string | undefined
      try {
        const modelPath = await this.deps.ensureModel(mode)
        // 本次作业独占的临时目录（以 .tmp 结尾，进程崩溃时由缓存的过期临时文件清理兜底）。
        directory = await this.deps.cache.prepareTemporary(keys.primary)
        if (!directory) throw new Error('缓存目录不可用，无法保存分离结果。')
        await fs.mkdir(directory, { recursive: true })
        const result = await this.deps.run({ source: content.path, mode, modelPath, outputDirectory: directory }, sharedSignal, report)
        sharedSignal.throwIfAborted()
        if ((await this.deps.identify(content.path)).identity !== content.identity) throw new Error('分离期间音频文件已改变，请重新分离。')
        const primaryPath = await this.adopt(keys.primary, result.primaryPath)
        const residualPath = await this.adopt(keys.residual, result.residualPath)
        this.deps.log('info', '人声分离完成', 'audio_separation.job.completed', {
          mode, provider: result.provider, sampleRate: result.sampleRate, channels: result.channels,
          decodeMs: Math.round(result.decodeMs), inferenceMs: Math.round(result.inferenceMs), durationMs: Date.now() - started,
        })
        return { primaryPath, residualPath, sampleRate: result.sampleRate, channels: result.channels, cached: false, provider: result.provider }
      } catch (error) {
        const cancelled = sharedSignal.aborted
        this.deps.log('warn', cancelled ? '人声分离已取消' : '人声分离失败', cancelled ? 'audio_separation.job.cancelled' : 'audio_separation.job.failed', { mode, durationMs: Date.now() - started, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) })
        throw error
      } finally {
        if (directory) await removeUnmanagedCachePath(path.resolve(directory), { recursive: true, force: true }).catch(() => undefined)
        this.active--
      }
    }, signal, progress)
  }
}
