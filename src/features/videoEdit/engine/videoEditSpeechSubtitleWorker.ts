import { buildSpeechSubtitles, type SpeechSubtitle } from '../../../core/videoEdit/speechSubtitles'

type BuildArguments = Parameters<typeof buildSpeechSubtitles>
export type SpeechSubtitleWorkerRequest = {
  original: BuildArguments[0]; timings: BuildArguments[1]; clip: BuildArguments[2]; rate: BuildArguments[3]
  options: BuildArguments[4]; pauses: BuildArguments[6]; textScope: BuildArguments[7]
}
export type SpeechSubtitleWorkerResponse = { result: SpeechSubtitle[] } | { error: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = async (event: MessageEvent<SpeechSubtitleWorkerRequest>): Promise<void> => {
  const { original, timings, clip, rate, options, pauses, textScope } = event.data
  try {
    const result = await buildSpeechSubtitles(original, timings, clip, rate, options, undefined, pauses, textScope)
    scope.postMessage({ result } satisfies SpeechSubtitleWorkerResponse)
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : '原文字幕对齐失败。' } satisfies SpeechSubtitleWorkerResponse)
  }
}
