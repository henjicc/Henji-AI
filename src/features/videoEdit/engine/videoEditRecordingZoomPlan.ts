import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditClipPictureSize, videoEditClipToFrame, videoEditFrameToClip } from '@/core/videoEdit/clipGeometry'
import type { RecordingZoomTransform } from '@/core/videoEdit/recordingZoom'
import type { VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'

/** 归一化画面坐标的仿射：x' = m0·x + m1·y + m4，y' = m2·x + m3·y + m5。 */
type Affine = [number, number, number, number, number, number]
/** 这一帧的缩放：输出像素 → 取样位置（`sample`）与 → 片段画面坐标（`clip`，判断是否在片段范围内）。 */
export interface RecordingZoomDraw { sample: Affine; clip: Affine }
/**
 * Transient render data for the recording effects, never persisted or exposed as editable parameters.
 * `frameContent` is the clip's drawn bounds (normalized x0, y0, x1, y1) that the recording frame lays out.
 */
export interface RecordingEffectsRenderInput { zoom?: RecordingZoomDraw; frameContent?: [number, number, number, number] }
type Composition = Pick<VideoEditComposition, 'media' | 'items' | 'width' | 'height' | 'sequences'>

function affine(map: (x: number, y: number) => [number, number]): Affine {
  const origin = map(0, 0); const x = map(1, 0); const y = map(0, 1)
  return [x[0] - origin[0], y[0] - origin[0], x[1] - origin[1], y[1] - origin[1], origin[0], origin[1]]
}
/**
 * 缩放发生在片段自身的画面范围内：输出像素先换回片段画面坐标，按视野放大，再换回序列画面上的取样位置。
 * 片段几何（位置、缩放、旋转、锚点）都是仿射，合成后仍是一个仿射，着色器只做一次矩阵乘法。
 */
export function recordingZoomDraw(zoom: RecordingZoomTransform, clip: VideoEditClip, document: Composition): RecordingZoomDraw | undefined {
  if (!(zoom.scale > 1 + 1e-6)) return undefined
  const picture = videoEditClipPictureSize(document, clip)
  const toClip = (x: number, y: number): [number, number] => { const q = videoEditFrameToClip(clip, picture, document, x, y); return [q.u, q.v] }
  const sample = (x: number, y: number): [number, number] => {
    const [u, v] = toClip(x, y)
    const p = videoEditClipToFrame(clip, picture, document, zoom.centerX + (u - 0.5) / zoom.scale, zoom.centerY + (v - 0.5) / zoom.scale)
    return [p.x, p.y]
  }
  return { sample: affine(sample), clip: affine(toClip) }
}
/** 片段画面在序列画面里的外接矩形（截到画面内）：录屏画框按它摆放内容。 */
export function recordingFrameContent(clip: VideoEditClip, document: Composition): [number, number, number, number] {
  const picture = videoEditClipPictureSize(document, clip)
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => videoEditClipToFrame(clip, picture, document, u, v))
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  return [clamp(Math.min(...corners.map(p => p.x))), clamp(Math.min(...corners.map(p => p.y))), clamp(Math.max(...corners.map(p => p.x))), clamp(Math.max(...corners.map(p => p.y)))]
}
export function planRecordingZoom(draw: RecordingZoomDraw | undefined, width: number, height: number): VideoEditBuiltinPlan {
  const uniforms = new Float32Array(16); uniforms.set([width, height, width, height])
  if (!draw) return { width, height, scratch: [], passes: [{ entry: 'copy', source: 'input', target: 'output', uniforms }] }
  const [s0, s1, s2, s3, s4, s5] = draw.sample; const [c0, c1, c2, c3, c4, c5] = draw.clip
  uniforms.set([s0, s1, s2, s3, s4, s5, c4, c5, c0, c1, c2, c3], 4)
  return { width, height, scratch: [], passes: [{ entry: 'recording_zoom', source: 'input', target: 'output', uniforms }] }
}
