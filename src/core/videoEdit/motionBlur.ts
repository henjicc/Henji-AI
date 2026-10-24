import { videoEditClipPictureSize, videoEditClipToFrame, type VideoEditClipPlacement } from './clipGeometry'
import type { VideoEditClip, VideoEditComposition } from './document'
import { evaluateVideoEditClip } from './keyframes'

/*
 * 运动模糊（重要记录 019，时间线统一开关）：180° 快门，以当前帧为中心前后各四分之一帧，沿片段的变换动画取几次样，
 * 合成器把这些样本平均后再叠到画面上。只看位置、缩放、旋转、锚点的关键帧；跟随、防抖带来的偏移在快门内视为不变。
 * 被主进程引用的可能：只用相对路径导入。
 */

/** 快门长度（帧）：180° 快门是半帧。 */
export const VIDEO_EDIT_MOTION_BLUR_SHUTTER = 0.5
/** 一层最多取样次数：位移越长样本越多，到这里封顶。 */
export const VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES = 16
const TRANSFORM_KEYS = ['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY'] as const
/** 快门内位移短于这个像素数时不模糊（肉眼看不出，省掉多次绘制）。 */
const MIN_TRAVEL_PX = 0.75
/** 平均每隔多少像素取一次样，样本之间不出现可见的断层。 */
const PX_PER_SAMPLE = 1.5

/** 渲染用的片段：带上快门内各取样时刻的变换（只在渲染时存在，不进文档）。 */
export type VideoEditMotionSampledClip = VideoEditClip & { motionSamples?: readonly VideoEditClipPlacement[] }

/**
 * 一层的快门取样。`source` 是带关键帧的原片段，`evaluated` 是当前帧已求值（含跟随、防抖、淡化）的片段：
 * 样本 = 当前变换 + 关键帧在快门内的变化量。没有变换动画或位移太短时返回 undefined。
 */
export function videoEditMotionBlurSamples(document: Pick<VideoEditComposition, 'media' | 'items' | 'width' | 'height' | 'sequences'>, source: VideoEditClip, evaluated: VideoEditClip, frame: number): VideoEditClipPlacement[] | undefined {
  if (source.disabledIntrinsicSections?.includes('motion') || !TRANSFORM_KEYS.some(key => source.curves?.[key]?.length)) return undefined
  const base = evaluateVideoEditClip(source, frame)
  const sample = (offset: number): VideoEditClipPlacement => {
    const at = evaluateVideoEditClip(source, frame + offset)
    return {
      x: evaluated.x + at.x - base.x, y: evaluated.y + at.y - base.y,
      scale: evaluated.scale * (base.scale > 0 ? at.scale / base.scale : 1), rotation: evaluated.rotation + at.rotation - base.rotation,
      anchorX: (evaluated.anchorX ?? .5) + (at.anchorX ?? .5) - (base.anchorX ?? .5), anchorY: (evaluated.anchorY ?? .5) + (at.anchorY ?? .5) - (base.anchorY ?? .5),
      ...(evaluated.scaleAspect !== undefined ? { scaleAspect: evaluated.scaleAspect } : {}),
    }
  }
  const half = VIDEO_EDIT_MOTION_BLUR_SHUTTER / 2
  const first = sample(-half), last = sample(half)
  const picture = videoEditClipPictureSize(document, source)
  const travel = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]].map(([u, v]) => {
    const a = videoEditClipToFrame(first, picture, document, u, v), b = videoEditClipToFrame(last, picture, document, u, v)
    return Math.hypot((a.x - b.x) * document.width, (a.y - b.y) * document.height)
  }))
  if (!(travel >= MIN_TRAVEL_PX)) return undefined
  const count = Math.min(VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES, Math.max(2, Math.ceil(travel / PX_PER_SAMPLE)))
  return Array.from({ length: count }, (_, index) => sample(((index + .5) / count - .5) * VIDEO_EDIT_MOTION_BLUR_SHUTTER))
}
