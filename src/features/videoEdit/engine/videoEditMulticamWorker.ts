import { videoEditAudioOffset } from '@/core/videoEdit/multicamSync'

self.onmessage = (event: MessageEvent<{ reference: Float32Array; candidate: Float32Array }>): void => {
  try { self.postMessage({ result: videoEditAudioOffset(event.data.reference, event.data.candidate) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
