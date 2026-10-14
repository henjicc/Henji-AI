import { analyzeVideoEditScreenAttention, type VideoEditScreenAttentionRequest } from './videoEditScreenAttentionAnalysis'
self.onmessage = (event: MessageEvent<VideoEditScreenAttentionRequest>): void => {
  void analyzeVideoEditScreenAttention(event.data).then(result => self.postMessage({ result }), (error: unknown) => self.postMessage({ error: error instanceof Error ? error.message : String(error) }))
}
