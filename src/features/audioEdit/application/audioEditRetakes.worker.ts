import { detectAudioEditRetakes, type AudioEditRetake, type AudioEditRetakeOptions } from '@/core/audioEdit/retakes'
import type { AudioEditTranscriptBlock } from '@/core/audioEdit/types'

export interface AudioEditRetakeRequest { blocks: AudioEditTranscriptBlock[]; options: AudioEditRetakeOptions }
export type AudioEditRetakeResponse = { retakes: AudioEditRetake[] } | { error: string }

self.onmessage = (event: MessageEvent<AudioEditRetakeRequest>) => {
  try {
    self.postMessage({ retakes: detectAudioEditRetakes(event.data.blocks, event.data.options) } satisfies AudioEditRetakeResponse)
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies AudioEditRetakeResponse)
  }
}
