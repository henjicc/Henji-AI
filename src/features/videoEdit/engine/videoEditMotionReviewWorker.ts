import { detectVideoEditBanding, type VideoEditBandingEvidence } from '../../../core/videoEdit/bandingReview'
import { compareVideoEditEffectPixels, type VideoEditEffectPixelEvidence } from '../../../core/videoEdit/effectPixelReview'
import { collectVideoEditMotionStructure, type VideoEditMotionStructureResult } from '../../../core/videoEdit/motionStructure'
import type { VideoEditComposition } from '../../../core/videoEdit/document'
import type { VideoEditSourceMapRange } from '../../../core/videoEdit/sourceMap'
import type { MotionReviewPolicy } from '../../../core/media/motionReview'
import { collectVideoEditCodeMotion } from '../../../core/videoEdit/codeMotionReview'
import type { CodeAuthorProgram as CodeMaterialProgram, CodeAuthorFrameObservation } from '../../../core/videoEdit/codeAuthorProgram'
import { collectVideoEditPixelMotion, type VideoEditPixelMotionInput } from '../../../core/videoEdit/pixelMotionReview'
import type { AudioContentAnalysis } from '../../../core/audioAnalysis/contentAnalysis'
import { videoEditCodeInputMotionPlacements } from '../../../core/videoEdit/codeInputMotion'
import type { VideoEditPixelMotionPlacement } from '../../../core/videoEdit/pixelMotionReview'
import type { CodeParameterDeclaration } from '../../../core/videoEdit/codeMaterial/contract'

/** `codeDeclarations`：引用片子数据的代码版本（按版本 ID）的参数声明，planInputsOnly 据此加上片子数据派生的取帧参数。 */
export interface VideoEditMotionReviewRequest { comparison?: [ImageBitmap, ImageBitmap, ImageBitmap]; composition: VideoEditComposition; range: VideoEditSourceMapRange; policy: MotionReviewPolicy; programs?: Record<string, CodeMaterialProgram>; pixels?: VideoEditPixelMotionInput[]; audios?: Record<string, AudioContentAnalysis>; planInputsOnly?: boolean; codeDeclarations?: Record<string, readonly CodeParameterDeclaration[]> }
export type VideoEditMotionReviewInput = VideoEditMotionReviewRequest | { comparison: [ImageBitmap, ImageBitmap] } | { banding: ImageBitmap }
export type VideoEditMotionReviewResult = VideoEditMotionStructureResult & { banding?: VideoEditBandingEvidence[]; comparison?: VideoEditEffectPixelEvidence; sampledCodeFrames?: number; sampledElements?: number; warnings?: string[]; inputPlacements?: VideoEditPixelMotionPlacement[] }
export type VideoEditMotionReviewResponse = { result: VideoEditMotionReviewResult } | { error: string } | { observeFrame: { id: number; composition: VideoEditComposition; frame: number } }
export type VideoEditMotionReviewMessage = VideoEditMotionReviewInput | { observation: { id: number; value: CodeAuthorFrameObservation } }
const scope = self as unknown as DedicatedWorkerGlobalScope
let nextMeasurement = 0
const measurements = new Map<number, (value: CodeAuthorFrameObservation) => void>()
scope.onmessage = async (event: MessageEvent<VideoEditMotionReviewMessage>): Promise<void> => {
  if ('observation' in event.data) { const { id, value } = event.data.observation; measurements.get(id)?.(value); measurements.delete(id); return }
  try {
    if ('banding' in event.data) {
      const image = event.data.banding
      try {
        const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('无法读取色带检查像素。')
        ctx.drawImage(image, 0, 0)
        scope.postMessage({ result: { records: [], sampledFrames: 0, sampledInstances: 0, banding: detectVideoEditBanding(ctx.getImageData(0, 0, image.width, image.height).data, image.width, image.height) } } satisfies VideoEditMotionReviewResponse)
      } finally { image.close() }
      return
    }
    if ('comparison' in event.data && event.data.comparison) {
      const images = event.data.comparison
      try {
        const { width, height } = images[0]
        if (images.some(image => image.width !== width || image.height !== height)) throw new Error('效果比较的画面尺寸不一致，请重查。')
        const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('无法读取效果比较像素。')
        const pixels = images.map(image => { ctx.clearRect(0, 0, width, height); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, width, height).data })
        scope.postMessage({ result: { records: [], sampledFrames: 0, sampledInstances: 0, comparison: compareVideoEditEffectPixels(pixels[0], pixels[1], pixels[2] ?? pixels[0], width, height) } } satisfies VideoEditMotionReviewResponse)
      } finally { images.forEach(image => image.close()) }
      return
    }
    if (!('composition' in event.data)) throw new Error('运动检查缺少剪辑内容。')
    const { composition, range, policy, programs, pixels } = event.data
    if (event.data.planInputsOnly) {
      const declarations = event.data.codeDeclarations
      scope.postMessage({ result: { records: [], sampledFrames: 0, sampledInstances: 0, inputPlacements: videoEditCodeInputMotionPlacements(composition, range, declarations && (instance => declarations[instance.versionId])) } } satisfies VideoEditMotionReviewResponse)
      return
    }
    const result: VideoEditMotionReviewResult = collectVideoEditMotionStructure(composition, range, policy)
    if (pixels) result.records.push(...collectVideoEditPixelMotion(pixels, composition.fps, policy))
    if (programs) {
      const code = await collectVideoEditCodeMotion(composition, range, programs, policy, (composition, frame) => new Promise<CodeAuthorFrameObservation>(resolve => {
        const id = nextMeasurement++; measurements.set(id, resolve)
        scope.postMessage({ observeFrame: { id, composition, frame } } satisfies VideoEditMotionReviewResponse)
      }))
      result.records.push(...code.records); result.sampledCodeFrames = code.sampledFrames; result.sampledElements = code.sampledElements; result.warnings = code.warnings
    }
    scope.postMessage({ result } satisfies VideoEditMotionReviewResponse)
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : '运动结构分析失败。' } satisfies VideoEditMotionReviewResponse) }
  finally { measurements.clear() }
}
