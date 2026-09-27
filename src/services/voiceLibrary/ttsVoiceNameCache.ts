import type { TtsVoice } from '@henjicc/ai-sdk'

const names = new Map<string, Map<string, string>>()

export function rememberTtsVoiceNames(modelId: string, voices: TtsVoice[]): void {
  names.set(modelId, new Map(voices.map((voice) => [voice.id, voice.name])))
}

export function getTtsVoiceName(modelId: string, voiceId: string): string | undefined {
  return names.get(modelId)?.get(voiceId)
}
