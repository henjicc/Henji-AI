import type { VideoEditAnnotationTarget } from '@/core/videoEdit/annotations'

type Point = { x: number; y: number }
type Size = { width: number; height: number }
/** 标签往哪边放：锚点（像素）、偏好方向（各轴 -1/0/1）；框和圈另给对边的锚点 y，换到下方时贴着下边。 */
export interface VideoEditAnnotationTagAnchor { at: Point; dir: Point; flipY?: number }

/** 标签离锚点与画面边的距离（像素）。 */
const GAP = 8
const MARGIN = 8

const sign = (value: number): number => Math.abs(value) < 1e-6 ? 0 : Math.sign(value)

/**
 * 标签挂在哪：箭头挂在尾端、往远离箭头的方向放（箭头读起来就是从标签指出去）；框、圈、笔迹挂在上边正中、往上放；
 * 点和编号挂在右上。画在画面上的文字本身就是说明，不再挂标签。
 */
export function videoEditAnnotationTagAnchor(target: VideoEditAnnotationTarget, size: Size): VideoEditAnnotationTagAnchor | null {
  const X = (value: number): number => value * size.width; const Y = (value: number): number => value * size.height
  if (target.kind === 'text') return null
  if (target.kind === 'arrow') {
    const dx = sign(target.from.x - target.to.x); const dy = sign(target.from.y - target.to.y)
    return { at: { x: X(target.from.x), y: Y(target.from.y) }, dir: { x: dx, y: dy || (dx ? 0 : 1) } }
  }
  const box = target.kind === 'region' || target.kind === 'ellipse' ? target : target.kind === 'element' ? target.region
    : target.kind === 'stroke' ? (() => {
      const points = target.strokes.flat(); const x = Math.min(...points.map(p => p.x)); const y = Math.min(...points.map(p => p.y))
      return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y }
    })() : undefined
  if (box) return { at: { x: X(box.x + box.width / 2), y: Y(box.y) }, dir: { x: 0, y: -1 }, flipY: Y(box.y + box.height) }
  if (target.kind === 'point') return { at: { x: X(target.x), y: Y(target.y) - 6 }, dir: { x: 1, y: -1 } }
  if (target.kind === 'marker') return { at: { x: X(target.x) + 10, y: Y(target.y) - 10 }, dir: { x: 1, y: -1 } }
  // 时间段与没有画面区域的元素批注：放在画面左上角
  return { at: { x: 0, y: 0 }, dir: { x: 1, y: 1 } }
}

/**
 * 标签左上角位置：先按偏好方向放；那一边放不下就换到对边（先换上下，再换左右，再两边都换），
 * 最后整体推回画面内，离边 MARGIN。只检查偏好方向所在的轴，另一轴交给最后的推回。
 */
export function placeVideoEditAnnotationTag(anchor: VideoEditAnnotationTagAnchor, tag: Size, frame: Size): Point {
  const anchorY = (dirY: number): number => dirY === anchor.dir.y || anchor.flipY === undefined ? anchor.at.y : anchor.flipY
  const centerOf = (dir: Point): Point => ({ x: anchor.at.x + dir.x * (tag.width / 2 + GAP), y: anchorY(dir.y) + dir.y * (tag.height / 2 + GAP) })
  const fits = (dir: Point): boolean => {
    const center = centerOf(dir)
    return (!dir.x || (center.x - tag.width / 2 >= MARGIN && center.x + tag.width / 2 <= frame.width - MARGIN))
      && (!dir.y || (center.y - tag.height / 2 >= MARGIN && center.y + tag.height / 2 <= frame.height - MARGIN))
  }
  const { x, y } = anchor.dir
  const dir = [{ x, y }, { x, y: -y }, { x: -x, y }, { x: -x, y: -y }].find(fits) ?? anchor.dir
  const center = centerOf(dir)
  return {
    x: Math.max(MARGIN, Math.min(frame.width - tag.width - MARGIN, center.x - tag.width / 2)),
    y: Math.max(MARGIN, Math.min(frame.height - tag.height - MARGIN, center.y - tag.height / 2)),
  }
}
