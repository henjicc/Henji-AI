import { analyzeVideoEditReframe, type VideoEditReframeAnalysisRequest } from './videoEditReframeAnalysis'
self.onmessage = (event: MessageEvent<VideoEditReframeAnalysisRequest>): void => {
  void analyzeVideoEditReframe(event.data).then(result => self.postMessage({ result }), (error: unknown) => self.postMessage({ error: error instanceof Error ? error.message : String(error) }))
}
