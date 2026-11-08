import { defineSpeechRecognitionDescriptor } from '..'
import { audioDurationPrice, type CapabilityPricing } from '../../../pricing/capabilityPricing'
import { QWEN_AUDIO_31_FILE_PRICING } from './pricing'

export type BailianAsrProtocol = 'fun-short-sse' | 'qwen-short' | 'file-async'

export interface BailianAsrPreset {
  id: string
  modelId: string
  protocol: BailianAsrProtocol
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
  /** Data URI 路径的原始音频上限；更大文件应走远端 URL 或异步文件转写。 */
  maxInlineBytes?: number
  asyncInputField?: 'file_urls' | 'file_url'
  /** Qwen-Audio-ASR 接口里按模型开放的参数：即时热词 vocabulary、方言保留 keep_dialect、短音频说话人分离。 */
  supports?: { vocabulary?: true; keepDialect?: true; speakerDiarization?: true }
}

// 价格为华北2（北京）原价，不含限时免费额度。
const FILE_PRICING = audioDurationPrice('CNY', 0.00022)

function definePreset(input: Omit<BailianAsrPreset, 'id' | 'descriptor'>, pricing: CapabilityPricing): BailianAsrPreset {
  const asynchronous = input.protocol === 'file-async'
  const id = `bailian.speech-recognition.${input.modelId}`
  return {
    ...input,
    id,
    descriptor: defineSpeechRecognitionDescriptor({
      id,
      source: { kind: 'builtin', namespace: '@henjicc/ai-sdk' },
      providerIds: ['bailian'],
      modelId: input.modelId,
      streaming: input.protocol === 'fun-short-sse',
      mediaTypes: ['audio/*', 'video/*'],
      features: asynchronous
        ? ['file-transcription', 'timestamps', 'async-polling']
        : ['short-audio', ...(input.protocol === 'fun-short-sse' ? ['timestamps'] : [])],
      tags: ['cloud', asynchronous ? 'long-audio' : 'short-audio'],
      pricing,
    }),
  }
}

export const bailianFunAsrFlash20260615 = definePreset({
  modelId: 'fun-asr-flash-2026-06-15',
  protocol: 'fun-short-sse',
  maxInlineBytes: 2_000_000_000,
}, FILE_PRICING)

export const bailianQwen3AsrFlash = definePreset({
  modelId: 'qwen3-asr-flash',
  protocol: 'qwen-short',
  // Official 10 MB encoded audio limit; raw bytes expand by 4/3.
  maxInlineBytes: 7_500_000,
}, FILE_PRICING)

export const bailianQwen3AsrFlash20260210 = definePreset({
  modelId: 'qwen3-asr-flash-2026-02-10',
  protocol: 'qwen-short',
  // Official 10 MB encoded audio limit; raw bytes expand by 4/3.
  maxInlineBytes: 7_500_000,
}, FILE_PRICING)

export const bailianFunAsr = definePreset({
  modelId: 'fun-asr',
  protocol: 'file-async',
  asyncInputField: 'file_urls',
}, FILE_PRICING)

export const bailianQwen3AsrFlashFiletrans = definePreset({
  modelId: 'qwen3-asr-flash-filetrans',
  protocol: 'file-async',
  asyncInputField: 'file_url',
}, FILE_PRICING)

export const bailianQwenAudio31AsrFlash = definePreset({ modelId: 'qwen-audio-3.1-asr-flash', protocol: 'fun-short-sse', maxInlineBytes: 7_500_000, supports: { vocabulary: true, keepDialect: true, speakerDiarization: true } }, QWEN_AUDIO_31_FILE_PRICING)
export const bailianQwenAudio31AsrFlashFiletrans = definePreset({ modelId: 'qwen-audio-3.1-asr-flash-filetrans', protocol: 'file-async', asyncInputField: 'file_urls', supports: { vocabulary: true, keepDialect: true } }, QWEN_AUDIO_31_FILE_PRICING)
// 3.0 与 3.1 是同一套 Qwen-Audio-ASR 接口；3.0 按音频秒数计费，3.1 按 token 计费。官方标注方言保留与短音频说话人分离仅 3.1 支持。
export const bailianQwenAudio30AsrFlash = definePreset({ modelId: 'qwen-audio-3.0-asr-flash', protocol: 'fun-short-sse', maxInlineBytes: 7_500_000, supports: { vocabulary: true } }, FILE_PRICING)
export const bailianQwenAudio30AsrFlashFiletrans = definePreset({ modelId: 'qwen-audio-3.0-asr-flash-filetrans', protocol: 'file-async', asyncInputField: 'file_urls', supports: { vocabulary: true } }, FILE_PRICING)

export const bailianNonRealtimeAsrPresets = [
  bailianFunAsrFlash20260615,
  bailianQwen3AsrFlash,
  bailianQwen3AsrFlash20260210,
  bailianFunAsr,
  bailianQwen3AsrFlashFiletrans,
  bailianQwenAudio31AsrFlash,
  bailianQwenAudio31AsrFlashFiletrans,
  bailianQwenAudio30AsrFlash,
  bailianQwenAudio30AsrFlashFiletrans,
] as const satisfies readonly BailianAsrPreset[]
