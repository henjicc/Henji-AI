import { defineSpeechRecognitionDescriptor } from '..'

export type BailianAsrProtocol = 'fun-short-sse' | 'qwen-short' | 'file-async'

export interface BailianAsrPreset {
  id: string
  modelId: string
  protocol: BailianAsrProtocol
  descriptor: ReturnType<typeof defineSpeechRecognitionDescriptor>
  /** Data URI 路径的原始音频上限；更大文件应走远端 URL 或异步文件转写。 */
  maxInlineBytes?: number
  asyncInputField?: 'file_urls' | 'file_url'
}

function definePreset(input: Omit<BailianAsrPreset, 'descriptor'>): BailianAsrPreset {
  const asynchronous = input.protocol === 'file-async'
  return {
    ...input,
    descriptor: defineSpeechRecognitionDescriptor({
      id: input.id,
      providerIds: ['bailian'],
      modelId: input.modelId,
      streaming: input.protocol === 'fun-short-sse',
      mediaTypes: ['audio/*', 'video/*'],
      features: asynchronous
        ? ['file-transcription', 'timestamps', 'async-polling']
        : ['short-audio', ...(input.protocol === 'fun-short-sse' ? ['timestamps'] : [])],
      tags: ['cloud', asynchronous ? 'long-audio' : 'short-audio'],
    }),
  }
}

export const bailianFunAsrFlash20260615 = definePreset({
  id: 'bailian.fun-asr-flash-2026-06-15',
  modelId: 'fun-asr-flash-2026-06-15',
  protocol: 'fun-short-sse',
  maxInlineBytes: 10 * 1024 * 1024,
})

export const bailianQwen3AsrFlash = definePreset({
  id: 'bailian.qwen3-asr-flash',
  modelId: 'qwen3-asr-flash',
  protocol: 'qwen-short',
  maxInlineBytes: 10 * 1024 * 1024,
})

export const bailianQwen3AsrFlash20260210 = definePreset({
  id: 'bailian.qwen3-asr-flash-2026-02-10',
  modelId: 'qwen3-asr-flash-2026-02-10',
  protocol: 'qwen-short',
  maxInlineBytes: 10 * 1024 * 1024,
})

export const bailianFunAsr = definePreset({
  id: 'bailian.fun-asr',
  modelId: 'fun-asr',
  protocol: 'file-async',
  asyncInputField: 'file_urls',
})

export const bailianQwen3AsrFlashFiletrans = definePreset({
  id: 'bailian.qwen3-asr-flash-filetrans',
  modelId: 'qwen3-asr-flash-filetrans',
  protocol: 'file-async',
  asyncInputField: 'file_url',
})

export const bailianNonRealtimeAsrPresets = [
  bailianFunAsrFlash20260615,
  bailianQwen3AsrFlash,
  bailianQwen3AsrFlash20260210,
  bailianFunAsr,
  bailianQwen3AsrFlashFiletrans,
] as const satisfies readonly BailianAsrPreset[]
