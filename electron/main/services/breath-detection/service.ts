import { createHash } from 'node:crypto'
import { BREATH_DETECTION_VERSION, breathDetectionSchema, type BreathDetection } from '../../../../src/core/audioAnalysis/breath/respiro'
import type { BreathDetectionJobResult } from '../local-inference/breath/protocol'
import type { ContentDiskCache } from '../media/content-disk-cache'
import type { MediaContentIdentity } from '../media/content-identity'
import { SharedMediaAnalysis } from '../media/shared-analysis'

/*
 * 呼吸声检测服务：按素材内容身份缓存（磁盘，可重建，不写进口播文档）；同一段录音的并发请求共用一次计算。
 * 模型第一次用到时自动下载（约 13 MB）；下载不了就如实报错，不拿能量阈值冒充呼吸检测。
 */

export interface BreathDetectionServiceDependencies {
  cache: ContentDiskCache
  identify(source: string): Promise<MediaContentIdentity>
  /** 确保呼吸声模型可用（可能触发下载），返回模型文件路径；不可用时抛错。 */
  ensureModel(): Promise<string>
  run(source: string, modelPath: string, signal: AbortSignal, progress: (value: number) => void): Promise<BreathDetectionJobResult>
  log(level: 'info' | 'warn', message: string, event: string, context: Record<string, unknown>): void
}

export class BreathDetectionService {
  private readonly shared = new SharedMediaAnalysis<BreathDetection>()
  constructor(private readonly deps: BreathDetectionServiceDependencies) {}

  private key(identity: string): string {
    return createHash('sha256').update(`breath-v${BREATH_DETECTION_VERSION}:respiro-en:${identity}`).digest('hex')
  }

  async detect(source: string, signal: AbortSignal, progress: (value: number) => void = () => undefined): Promise<{ detection: BreathDetection; cached: boolean }> {
    signal.throwIfAborted()
    const content = await this.deps.identify(source)
    const key = this.key(content.identity)
    const bytes = await this.deps.cache.read(key)
    if (bytes) {
      try { return { detection: breathDetectionSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8'))), cached: true } } catch (error) {
        this.deps.log('warn', '呼吸声检测缓存无效，已丢弃', 'breath_detection.cache.invalid', { reason: error instanceof Error ? error.message.slice(0, 200) : String(error) })
        await this.deps.cache.remove(key)
      }
    }
    const detection = await this.shared.run(key, async (sharedSignal, report) => {
      const modelPath = await this.deps.ensureModel()
      const computed = await this.deps.run(content.path, modelPath, sharedSignal, report)
      sharedSignal.throwIfAborted()
      if ((await this.deps.identify(content.path)).identity !== content.identity) throw new Error('检测期间音频文件已改变，请重新检测。')
      const parsed = breathDetectionSchema.parse(computed.detection)
      await this.deps.cache.write(key, Buffer.from(JSON.stringify(parsed)))
      return parsed
    }, signal, progress)
    return { detection, cached: false }
  }
}
