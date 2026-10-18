import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import { speechEnergyAnalysisSchema, speechEnergyOptionsSchema, type SpeechEnergyAnalysis, type SpeechEnergyOptions } from '../../../../src/core/audioEdit/speechEnergy'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { identifyMediaContent } from '../media/content-identity'
import { SharedMediaAnalysis } from '../media/shared-analysis'
import { decodeSpeechEnergy } from './speech-energy'

const entrySchema = z.object({ version: z.literal(1), key: z.string().regex(/^[a-f0-9]{64}$/), result: speechEnergyAnalysisSchema }).strict()

/** Rebuildable source facts only. Captions, user corrections and sequence projections stay in their documents. */
export class SpeechEnergyService {
  private readonly shared = new SharedMediaAnalysis<SpeechEnergyAnalysis>()
  private readonly memory = new Map<string, SpeechEnergyAnalysis>()
  constructor(private readonly disk?: ContentDiskCache, private readonly run = decodeSpeechEnergy, private readonly onCacheError?: (event: string, error: unknown) => void) {}
  async analyze(source: AudioEditSourceMetadata, raw: SpeechEnergyOptions, signal: AbortSignal, progress: (value: number) => void, verifySource: (signal: AbortSignal) => Promise<void>): Promise<SpeechEnergyAnalysis> {
    signal.throwIfAborted()
    const options = speechEnergyOptionsSchema.parse(raw)
    const content = await identifyMediaContent(source.sourcePath)
    const audio = source.audioPath === source.sourcePath ? content : await identifyMediaContent(source.audioPath)
    const key = createHash('sha256').update(JSON.stringify(['speech-energy-v1', content.identity, audio.identity, source.identity?.digest, source.audioStreamIndex, source.ownership, options])).digest('hex')
    const assertContentCurrent = async (verificationSignal: AbortSignal): Promise<void> => {
      verificationSignal.throwIfAborted()
      if ((await identifyMediaContent(source.sourcePath)).identity !== content.identity || (await identifyMediaContent(source.audioPath)).identity !== audio.identity) throw new Error('检测期间原素材已改变，请重新分析。')
      verificationSignal.throwIfAborted()
    }
    const verify = async (verificationSignal: AbortSignal): Promise<void> => {
      verificationSignal.throwIfAborted()
      await verifySource(verificationSignal)
      await assertContentCurrent(verificationSignal)
    }
    let cached = this.memory.get(key)
    if (!cached && this.disk) {
      const bytes = await this.disk.read(key)
      signal.throwIfAborted()
      if (bytes) {
        try {
          if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('声音证据缓存超过大小上限。')
          const entry = entrySchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
          if (entry.key !== key) throw new Error('声音证据缓存与来源不匹配。')
          cached = entry.result
        } catch (error) {
          this.onCacheError?.('invalid', error)
          await this.disk.remove(key).catch(removalError => this.onCacheError?.('remove_failed', removalError))
        }
      }
    }
    if (cached) {
      await verify(signal)
      this.remember(key, cached)
      progress(1)
      return structuredClone(cached)
    }
    return this.shared.run(key, async (sharedSignal, report) => {
      // Another flight can finish between disk lookup and subscription.
      const ready = this.memory.get(key)
      if (ready) { await verify(sharedSignal); report(1); return ready }
      const result = speechEnergyAnalysisSchema.parse(await this.run(source, options, sharedSignal, report))
      await verify(sharedSignal)
      if (this.disk) {
        try { await this.disk.write(key, Buffer.from(JSON.stringify({ version: 1, key, result }))) }
        catch (error) { this.onCacheError?.('write_failed', error) }
        await assertContentCurrent(sharedSignal)
      }
      sharedSignal.throwIfAborted()
      this.remember(key, result)
      report(1)
      return result
    }, signal, progress)
  }
  private remember(key: string, result: SpeechEnergyAnalysis): void {
    this.memory.delete(key); this.memory.set(key, structuredClone(result))
    while (this.memory.size > 8) this.memory.delete(this.memory.keys().next().value as string)
  }
}
