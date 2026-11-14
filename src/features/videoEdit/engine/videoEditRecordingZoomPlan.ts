import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditClipPictureSize, videoEditClipToFrame, videoEditFrameToClip } from '@/core/videoEdit/clipGeometry'
import type { RecordingZoomTransform } from '@/core/videoEdit/recordingZoom'
import { VIDEO_EDIT_MOTION_BLUR_MIN_TRAVEL_PX, VIDEO_EDIT_MOTION_BLUR_PX_PER_SAMPLE } from '@/core/videoEdit/motionBlur'
import type { VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'

/** 归一化画面坐标的仿射：x' = m0·x + m1·y + m4，y' = m2·x + m3·y + m5。 */
type Affine = [number, number, number, number, number, number]
/**
 * 这一帧的缩放：输出像素 → 取样位置（`sample`）与 → 片段画面坐标（`clip`，判断是否在片段范围内）。
 * `shutter` 是快门打开那一刻的取样仿射与取样次数：镜头在快门内真的动了才有，着色器沿两者之间多次取样平均成运动模糊。
 */
export interface RecordingZoomDraw { sample: Affine; clip: Affine; shutter?: { sample: Affine; samples: number } }
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
 * 片段几何（位置、缩放、旋转、锚点）都是仿射，合成后仍是一个仿射，着色器只做一次矩阵乘法；
 * 换算下来取样仿射总是各向同性（x/视野倍数 + 平移），着色器按这个形状打包。
 * `shutter` 给出快门打开时的视野与最多取样次数时，按输出画面上内容实际移动的距离决定取样次数，静止时不模糊。
 */
export function recordingZoomDraw(zoom: RecordingZoomTransform, clip: VideoEditClip, document: Composition, shutter?: { zoom: RecordingZoomTransform; maxSamples: number }): RecordingZoomDraw | undefined {
  if (!(zoom.scale > 1 + 1e-6) && !(shutter && shutter.zoom.scale > 1 + 1e-6)) return undefined
  const picture = videoEditClipPictureSize(document, clip)
  const toClip = (x: number, y: number): [number, number] => { const q = videoEditFrameToClip(clip, picture, document, x, y); return [q.u, q.v] }
  const sampleOf = (view: RecordingZoomTransform): Affine => affine((x, y) => {
    const [u, v] = toClip(x, y)
    const p = videoEditClipToFrame(clip, picture, document, view.centerX + (u - 0.5) / view.scale, view.centerY + (v - 0.5) / view.scale)
    return [p.x, p.y]
  })
  const sample = sampleOf(zoom)
  const draw: RecordingZoomDraw = { sample, clip: affine(toClip) }
  if (!shutter) return draw
  const open = sampleOf(shutter.zoom)
  // 输出点 x 现在显示的内容（取样位置 p），在快门打开时显示在 (p − 平移₀) / 倍数₀；两者之差就是画面上的移动。
  const travel = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]].map(([x, y]) => {
    const px = sample[0] * x + sample[4]; const py = sample[3] * y + sample[5]
    return Math.hypot(((px - open[4]) / open[0] - x) * document.width, ((py - open[5]) / open[3] - y) * document.height)
  }))
  if (!(travel >= VIDEO_EDIT_MOTION_BLUR_MIN_TRAVEL_PX)) return draw
  return { ...draw, shutter: { sample: open, samples: Math.min(shutter.maxSamples, Math.max(2, Math.ceil(travel / VIDEO_EDIT_MOTION_BLUR_PX_PER_SAMPLE))) } }
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
  const [m, , , , tx, ty] = draw.sample; const [c0, c1, c2, c3, c4, c5] = draw.clip
  const [m0, , , , tx0, ty0] = draw.shutter?.sample ?? draw.sample
  uniforms.set([width, height, draw.shutter?.samples ?? 1, 0, m, tx, ty, m0, tx0, ty0, c4, c5, c0, c1, c2, c3])
  return { width, height, scratch: [], passes: [{ entry: 'recording_zoom', source: 'input', target: 'output', uniforms }] }
}
