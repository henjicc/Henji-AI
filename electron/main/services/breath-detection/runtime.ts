import { randomUUID } from 'node:crypto'
import { createMainLogger } from '../logging'
import { executionProviderOrder } from '../local-inference/providers'
import { ensureLocalModel } from '../local-models/runtime'
import { identifyMediaContent } from '../media/content-identity'
import { getMediaCacheManager } from '../media/media-cache-runtime'
import { getLocalInferenceHost } from '../smart-regions/runtime'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { BreathDetectionService } from './service'

/** 呼吸声检测的进程内单例：缓存放媒体缓存的“分析”分类，计算交给本地推理后台进程。 */

const logger = createMainLogger('main.breath_detection')
let service: BreathDetectionService | undefined

export function getBreathDetectionService(): BreathDetectionService {
  if (service) return service
  const host = getLocalInferenceHost()
  const providers = executionProviderOrder(process.platform)
  service = new BreathDetectionService({
    cache: getMediaCacheManager().createCache('analysis', 'breath', { extension: '.json', budgetBytes: 32 * 1024 ** 2, onError: (event, error) => logger.warn('呼吸声检测缓存操作失败', { event: `breath_detection.cache.${event}`, error }) }),
    identify: identifyMediaContent,
    ensureModel: async () => {
      const file = (await ensureLocalModel('speech_breath_respiro')).files.find(entry => entry.name === 'respiro-en.onnx')
      if (!file) throw new Error('呼吸声模型缺少 respiro-en.onnx。')
      return file.path
    },
    run: async (source, modelPath, signal, progress) => {
      const id = randomUUID()
      const abort = (): void => host.cancel(id)
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await host.detectBreaths({ id, ffmpegPath: await loadFfmpegPath(), source, modelPath, providers }, (done, total) => progress(total ? done / total : 0))
      } finally { signal.removeEventListener('abort', abort) }
    },
    log: (level, message, event, context) => logger[level](message, { event, context }),
  })
  return service
}
