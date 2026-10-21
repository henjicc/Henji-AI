import { createHash } from 'node:crypto'
import { MUSIC_ANALYSIS_VERSION, musicAnalysisSchema, type MusicAnalysis } from '../../../../src/core/audioAnalysis/music/musicAnalysis'
import type { MusicAnalysisProgress, MusicAnalysisResponse } from '../../../../src/platform/contracts/musicAnalysis'
import type { MusicAnalysisJobResult, MusicBeatModel } from '../local-inference/music/protocol'
import type { ContentDiskCache } from '../media/content-disk-cache'
import type { MediaContentIdentity } from '../media/content-identity'
import { SharedMediaAnalysis } from '../media/shared-analysis'

/*
 * 音乐结构分析服务：按素材内容身份缓存（磁盘，可重建，不写进工程文档）；同一首曲子的并发请求共用一次计算。
 * 节拍模型优先：缓存里有模型结果直接用；否则先确保模型（首次自动下载），失败才用谱通量回退，回退结果单独缓存，
 * 之后模型可用时会重新分析。
 */

type BeatSource = MusicAnalysis['beatSource']

export interface MusicAnalysisServiceDependencies {
  cache: ContentDiskCache
  identify(source: string): Promise<MediaContentIdentity>
  /** 确保节拍模型可用（可能触发下载）；不可用时抛错。 */
  ensureModel(): Promise<MusicBeatModel>
  run(source: string, model: MusicBeatModel | undefined, signal: AbortSignal, progress: (value: number) => void): Promise<MusicAnalysisJobResult>
  log(level: 'info' | 'warn', message: string, event: string, context: Record<string, unknown>): void
}

export function musicAnalysisIdentity(beatSource: BeatSource, contentIdentity: string): string {
  return `music-v${MUSIC_ANALYSIS_VERSION}:${beatSource}:${contentIdentity}`
}

export class MusicAnalysisService {
  private readonly shared = new SharedMediaAnalysis<MusicAnalysisJobResult>()
  constructor(private readonly deps: MusicAnalysisServiceDependencies) {}

  private key(beatSource: BeatSource, identity: string): string {
    return createHash('sha256').update(musicAnalysisIdentity(beatSource, identity)).digest('hex')
  }

  private async cached(beatSource: BeatSource, content: MediaContentIdentity): Promise<MusicAnalysis | null> {
    const key = this.key(beatSource, content.identity)
    const bytes = await this.deps.cache.read(key)
    if (!bytes) return null
    try {
      const analysis = musicAnalysisSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
      if (analysis.beatSource !== beatSource) throw new Error('缓存的节拍来源不符。')
      return analysis
    } catch (error) {
      this.deps.log('warn', '音乐分析缓存无效，已丢弃', 'music_analysis.cache.invalid', { reason: error instanceof Error ? error.message.slice(0, 200) : String(error) })
      await this.deps.cache.remove(key)
      return null
    }
  }

  async analyze(source: string, signal: AbortSignal, progress: (event: Omit<MusicAnalysisProgress, 'requestId'>) => void): Promise<MusicAnalysisResponse> {
    signal.throwIfAborted()
    const started = Date.now()
    const content = await this.deps.identify(source)
    const fromModel = await this.cached('beat_this', content)
    if (fromModel) return { analysis: fromModel, analysisIdentity: musicAnalysisIdentity('beat_this', content.identity), cached: true, model: 'used', timings: null }
    let model: MusicBeatModel | undefined
    progress({ phase: 'model', progress: 0 })
    try { model = await this.deps.ensureModel() } catch (error) {
      this.deps.log('warn', '节拍模型不可用，改用谱通量回退', 'music_analysis.model.unavailable', { reason: error instanceof Error ? error.message.slice(0, 200) : String(error) })
    }
    signal.throwIfAborted()
    progress({ phase: 'model', progress: 1 })
    const beatSource: BeatSource = model ? 'beat_this' : 'spectral_flux'
    if (!model) {
      const fallback = await this.cached('spectral_flux', content)
      if (fallback) return { analysis: fallback, analysisIdentity: musicAnalysisIdentity('spectral_flux', content.identity), cached: true, model: 'fallback', timings: null }
    }
    const key = this.key(beatSource, content.identity)
    const result = await this.shared.run(key, async (sharedSignal, report) => {
      const computed = await this.deps.run(content.path, model, sharedSignal, report)
      sharedSignal.throwIfAborted()
      if ((await this.deps.identify(content.path)).identity !== content.identity) throw new Error('分析期间音频文件已改变，请重新分析。')
      await this.deps.cache.write(key, Buffer.from(JSON.stringify(musicAnalysisSchema.parse(computed.analysis))))
      return computed
    }, signal, value => progress({ phase: 'analyze', progress: value }))
    signal.throwIfAborted()
    return {
      analysis: result.analysis, analysisIdentity: musicAnalysisIdentity(beatSource, content.identity), cached: false, model: model ? 'used' : 'fallback',
      timings: { decodeMs: result.decodeMs, inferenceMs: result.inferenceMs, featureMs: result.featureMs, totalMs: Date.now() - started },
    }
  }
}
