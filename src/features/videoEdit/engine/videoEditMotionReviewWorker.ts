import { collectVideoEditMotionStructure, type VideoEditMotionStructureResult } from '../../../core/videoEdit/motionStructure'
import type { VideoEditComposition } from '../../../core/videoEdit/document'
import type { VideoEditSourceMapRange } from '../../../core/videoEdit/sourceMap'
import type { MotionReviewPolicy } from '../../../core/media/motionReview'

export interface VideoEditMotionReviewRequest { composition: VideoEditComposition; range: VideoEditSourceMapRange; policy: MotionReviewPolicy }
export type VideoEditMotionReviewResponse = { result: VideoEditMotionStructureResult } | { error: string }
const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = (event: MessageEvent<VideoEditMotionReviewRequest>): void => {
  try {
    const { composition, range, policy } = event.data
    scope.postMessage({ result: collectVideoEditMotionStructure(composition, range, policy) } satisfies VideoEditMotionReviewResponse)
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : '运动结构分析失败。' } satisfies VideoEditMotionReviewResponse) }
}
