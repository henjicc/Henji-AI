import { collectVideoEditMotionStructure, type VideoEditMotionStructureResult } from '../../../core/videoEdit/motionStructure'
import type { VideoEditComposition } from '../../../core/videoEdit/document'
import type { VideoEditSourceMapRange } from '../../../core/videoEdit/sourceMap'
import type { MotionReviewPolicy } from '../../../core/media/motionReview'
import { collectVideoEditCodeMotion } from '../../../core/videoEdit/codeMotionReview'
import type { CodeMaterialProgram, CodeTextLayout, CodeTextMeasureRequest } from '../../../core/videoEdit/codeMaterial/contract'

export interface VideoEditMotionReviewRequest { composition: VideoEditComposition; range: VideoEditSourceMapRange; policy: MotionReviewPolicy; programs?: Record<string, CodeMaterialProgram> }
export type VideoEditMotionReviewResult = VideoEditMotionStructureResult & { sampledCodeFrames?: number; sampledElements?: number; warnings?: string[] }
export type VideoEditMotionReviewResponse = { result: VideoEditMotionReviewResult } | { error: string } | { measureText: { id: number; request: CodeTextMeasureRequest } }
export type VideoEditMotionReviewMessage = VideoEditMotionReviewRequest | { measurement: { id: number; layout: CodeTextLayout } }
const scope = self as unknown as DedicatedWorkerGlobalScope
let nextMeasurement = 0
const measurements = new Map<number, (layout: CodeTextLayout) => void>()
scope.onmessage = async (event: MessageEvent<VideoEditMotionReviewMessage>): Promise<void> => {
  if ('measurement' in event.data) { const { id, layout } = event.data.measurement; measurements.get(id)?.(layout); measurements.delete(id); return }
  try {
    const { composition, range, policy, programs } = event.data
    const result: VideoEditMotionReviewResult = collectVideoEditMotionStructure(composition, range, policy)
    if (programs) {
      const code = await collectVideoEditCodeMotion(composition, range, programs, policy, request => new Promise<CodeTextLayout>(resolve => {
        const id = nextMeasurement++; measurements.set(id, resolve)
        scope.postMessage({ measureText: { id, request } } satisfies VideoEditMotionReviewResponse)
      }))
      result.records.push(...code.records); result.sampledCodeFrames = code.sampledFrames; result.sampledElements = code.sampledElements; result.warnings = code.warnings
    }
    scope.postMessage({ result } satisfies VideoEditMotionReviewResponse)
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : '运动结构分析失败。' } satisfies VideoEditMotionReviewResponse) }
  finally { measurements.clear() }
}
