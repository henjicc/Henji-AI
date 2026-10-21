import { randomUUID } from 'node:crypto'
import { createMainLogger } from '../logging'
import { executionProviderOrder } from '../local-inference/providers'
import { ensureLocalModel } from '../local-models/runtime'
import { identifyMediaContent } from '../media/content-identity'
import { getMediaCacheManager } from '../media/media-cache-runtime'
import { getLocalInferenceHost } from '../smart-regions/runtime'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { MusicAnalysisService } from './service'

/** 音乐结构分析的进程内单例：缓存放媒体缓存的“分析”分类，计算交给本地推理后台进程。 */

const logger = createMainLogger('main.music_analysis')
let service: MusicAnalysisService | undefined

export function getMusicAnalysisService(): MusicAnalysisService {
  if (service) return service
  const host = getLocalInferenceHost()
  const providers = executionProviderOrder(process.platform)
  service = new MusicAnalysisService({
    cache: getMediaCacheManager().createCache('analysis', 'music', { extension: '.json', budgetBytes: 64 * 1024 ** 2, onError: (event, error) => logger.warn('音乐分析缓存操作失败', { event: `music_analysis.cache.${event}`, error }) }),
    identify: identifyMediaContent,
    ensureModel: async () => {
      const files = (await ensureLocalModel('music_beats_beat_this')).files
      const find = (name: string): string => {
        const file = files.find(entry => entry.name === name)
        if (!file) throw new Error(`节拍模型缺少 ${name}。`)
        return file.path
      }
      return { modelPath: find('beat_this.onnx'), filterbankPath: find('mel-filterbank.bin') }
    },
    run: async (source, model, signal, progress) => {
      const id = randomUUID()
      const abort = (): void => host.cancel(id)
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await host.analyzeMusic({ id, ffmpegPath: await loadFfmpegPath(), source, ...(model ? { model } : {}), providers }, (done, total) => progress(total ? done / total : 0))
      } finally { signal.removeEventListener('abort', abort) }
    },
    log: (level, message, event, context) => logger[level](message, { event, context }),
  })
  return service
}
