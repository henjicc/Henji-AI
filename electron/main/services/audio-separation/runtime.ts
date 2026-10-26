import { randomUUID } from 'node:crypto'
import type { LocalModelId } from '../../../../src/platform/contracts/localModels'
import type { AudioSeparationMode } from '../local-inference/separation/protocol'
import { executionProviderOrder } from '../local-inference/providers'
import { createMainLogger } from '../logging'
import { findLocalModelSpec } from '../local-models/manifest'
import { ensureLocalModel } from '../local-models/runtime'
import { identifyMediaContent } from '../media/content-identity'
import { getMediaCacheManager } from '../media/media-cache-runtime'
import { getLocalInferenceHost } from '../smart-regions/runtime'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { registerWorkRootBusyProbe } from '../work-root/busy-probes'
import { AudioSeparationService, type AudioSeparationResult } from './service'

/*
 * 人声分离与去混响的进程内单例：结果缓存放媒体缓存的“分析”分类，计算交给本地推理后台进程。
 *
 * 执行设备按平台顺序（Windows：DirectML → CPU），后台进程先用合成声音把 DirectML 与 CPU 核对一次，
 * 结果异常（全零、非数值、差异过大）才整段改用 CPU。2026-10-26 RTX 4090 实测：两者主分量相对误差约 1e-6，
 * DirectML 每块 30–65 ms，CPU（Ryzen 9 5900X）每块 1.9–4 s，DirectML 快几十倍。
 */

const logger = createMainLogger('main.audio_separation')
const MODEL_IDS: Readonly<Record<AudioSeparationMode, LocalModelId>> = { vocals: 'audio_separation_kim_vocal_2', dereverb: 'audio_dereverb_foxjoy' }
let service: AudioSeparationService | undefined

function modelFile(mode: AudioSeparationMode): { name: string; sha256: string } {
  const file = findLocalModelSpec(MODEL_IDS[mode]).files.find(entry => entry.role === 'model')
  if (!file) throw new Error(`本地模型 ${MODEL_IDS[mode]} 缺少模型文件。`)
  return file
}

export function getAudioSeparationService(): AudioSeparationService {
  if (service) return service
  const host = getLocalInferenceHost()
  const created = new AudioSeparationService({
    // 10 分钟 44.1 kHz 立体声的一对结果约 420 MB；超过 4 GB 按最久未用清理。
    cache: getMediaCacheManager().createCache('analysis', 'separation', { extension: '.wav', budgetBytes: 4 * 1024 ** 3, onError: (event, error) => logger.warn('人声分离缓存操作失败', { event: `audio_separation.cache.${event}`, error }) }),
    identify: identifyMediaContent,
    modelSha256: mode => modelFile(mode).sha256,
    ensureModel: async (mode) => {
      const name = modelFile(mode).name
      const file = (await ensureLocalModel(MODEL_IDS[mode])).files.find(entry => entry.name === name)
      if (!file) throw new Error(`本地模型 ${MODEL_IDS[mode]} 缺少 ${name}。`)
      return file.path
    },
    run: async (request, signal, progress) => {
      const id = randomUUID()
      const abort = (): void => host.cancel(id)
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await host.separateAudio({ id, ffmpegPath: await loadFfmpegPath(), providers: executionProviderOrder(process.platform), ...request }, (done, total) => progress(total ? done / total : 0))
      } finally { signal.removeEventListener('abort', abort) }
    },
    log: (level, message, event, context) => logger[level](message, { event, context }),
  })
  // 结果写在作品目录的缓存里，分离期间不允许更换作品目录。
  registerWorkRootBusyProbe('audio_separation', { reason: '还有人声分离正在进行', isBusy: () => created.hasActiveJobs() })
  service = created
  return created
}

export interface SeparateAudioFileOptions {
  /** 任意音频或带音轨的视频文件。 */
  source: string
  /** `vocals`：人声 / 伴奏；`dereverb`：干声 / 混响。 */
  mode: AudioSeparationMode
  signal?: AbortSignal
  /** 0–1。 */
  onProgress?: (value: number) => void
}

/** 分离一个文件：模型按需下载，结果按内容缓存（命中直接返回，不重复推理）。 */
export function separateAudioFile(options: SeparateAudioFileOptions): Promise<AudioSeparationResult> {
  return getAudioSeparationService().separate(options.source, options.mode, options.signal ?? new AbortController().signal, options.onProgress)
}
