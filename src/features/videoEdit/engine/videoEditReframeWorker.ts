import { analyzeVideoEditReframe, type VideoEditReframeAnalysisRequest } from './videoEditReframeAnalysis'
import { configureVideoEditRecordingTrackReader } from './videoEditTrackResults'
import { fetchRecordingCursorPage } from './videoEditRecordingCursorSource'

// 重构分析 Worker 收到的事件页是会话边界换好的媒体地址。
configureVideoEditRecordingTrackReader(fetchRecordingCursorPage)
self.onmessage = (event: MessageEvent<VideoEditReframeAnalysisRequest>): void => {
  void analyzeVideoEditReframe(event.data).then(result => self.postMessage({ result }), (error: unknown) => self.postMessage({ error: error instanceof Error ? error.message : String(error) }))
}
