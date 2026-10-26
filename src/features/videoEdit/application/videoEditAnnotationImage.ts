import { videoEditAnnotationAt, videoEditAnnotationBounds, videoEditAnnotationColor, type VideoEditAnnotation } from '@/core/videoEdit/annotations'
import { VIDEO_EDIT_ANNOTATION_COLORS } from '@/core/theme/colorTokens'

export interface VideoEditAnnotationObservationOptions {
  overlayAnnotations?: boolean
  annotationIds?: string[]
  cropAnnotationId?: string
  highlightElement?: { clipId: string; elementId: string }
}
export function prepareVideoEditAnnotationObservation(marks: readonly VideoEditAnnotation[], frame: number, options: VideoEditAnnotationObservationOptions) {
  const wanted = new Set(options.annotationIds)
  for (const id of [...wanted, ...(options.cropAnnotationId ? [options.cropAnnotationId] : [])]) {
    const mark = marks.find(mark => mark.id === id)
    if (!mark) throw new Error(`标注 ${id} 不属于此序列，请列出 video_edit.annotation 并读取 target。`)
    if (!videoEditAnnotationAt(mark, frame)) throw new Error(`标注 ${id} 不在当前帧，请使用该标注的 frame。`)
  }
  const overlays = marks.flatMap((mark, index) => videoEditAnnotationAt(mark, frame) && (wanted.size ? wanted.has(mark.id) : options.overlayAnnotations && mark.status !== 'resolved') ? [{ mark, number: index + 1 }] : [])
  const crop = options.cropAnnotationId ? videoEditAnnotationBounds(marks.find(mark => mark.id === options.cropAnnotationId)!) : undefined
  if (options.cropAnnotationId && !crop) throw new Error('此标注没有画面区域；时间段请观察完整帧，代码元素请提供目标 region 后放大。')
  return { overlays, crop }
}
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
/**
 * Overlay coordinates use the same normalized targets as the monitor, remapped into a cropped image. Shapes use the
 * annotation's own colour (red by default); the numbered badge carries the review state, so agents can tell them apart.
 */
export function paintVideoEditAnnotationObservation(context: Context, width: number, height: number, overlays: ReturnType<typeof prepareVideoEditAnnotationObservation>['overlays'], crop?: { x: number; y: number; width: number; height: number }): void {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string): string => `rgb(${css.getPropertyValue(`--${name}-rgb`).trim()})`
  const transform = (x: number, y: number): [number, number] => [(x - (crop?.x ?? 0)) / (crop?.width ?? 1) * width, (y - (crop?.y ?? 0)) / (crop?.height ?? 1) * height]
  const scaleX = (value: number): number => value / (crop?.width ?? 1) * width
  const scaleY = (value: number): number => value / (crop?.height ?? 1) * height
  const line = Math.max(2, width / 480)
  context.save()
  context.lineCap = 'round'; context.lineJoin = 'round'
  for (const { mark, number } of overlays) {
    const target = mark.target
    const color = VIDEO_EDIT_ANNOTATION_COLORS[videoEditAnnotationColor(mark)]
    context.strokeStyle = color; context.fillStyle = color
    context.lineWidth = line; context.setLineDash(mark.status === 'draft' ? [line * 3, line * 2] : [])
    let label: [number, number] = [8, 20 + (number - 1) * 24]
    if (target.kind === 'point') { label = transform(target.x, target.y); context.beginPath(); context.arc(...label, line * 3, 0, Math.PI * 2); context.stroke() }
    const box = target.kind === 'region' ? target : target.kind === 'element' ? target.region : undefined
    if (box) { label = transform(box.x, box.y); context.strokeRect(...label, scaleX(box.width), scaleY(box.height)) }
    if (target.kind === 'ellipse') {
      const [x, y] = transform(target.x, target.y); const rx = scaleX(target.width) / 2; const ry = scaleY(target.height) / 2
      label = [x, y]; context.beginPath(); context.ellipse(x + rx, y + ry, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); context.stroke()
    }
    if (target.kind === 'stroke') for (const stroke of target.strokes) {
      context.beginPath(); stroke.forEach((point, index) => { const at = transform(point.x, point.y); if (!index) { context.moveTo(...at); label = at } else context.lineTo(...at) }); context.stroke()
    }
    if (target.kind === 'arrow') {
      const from = transform(target.from.x, target.from.y); const to = transform(target.to.x, target.to.y)
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0]); const head = line * 5
      label = from
      context.beginPath(); context.moveTo(...from); context.lineTo(to[0] - Math.cos(angle) * head * 0.6, to[1] - Math.sin(angle) * head * 0.6); context.stroke()
      context.setLineDash([]); context.beginPath(); context.moveTo(...to)
      context.lineTo(to[0] - Math.cos(angle - 0.45) * head, to[1] - Math.sin(angle - 0.45) * head)
      context.lineTo(to[0] - Math.cos(angle + 0.45) * head, to[1] - Math.sin(angle + 0.45) * head)
      context.closePath(); context.fill()
    }
    if (target.kind === 'marker') {
      const at = transform(target.x, target.y); const radius = line * 6
      label = [at[0] + radius, at[1] - radius]
      context.setLineDash([]); context.beginPath(); context.arc(...at, radius, 0, Math.PI * 2); context.fill()
      context.font = `600 ${Math.round(radius * 1.15)}px sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'
      context.fillStyle = videoEditAnnotationColor(mark) === 'white' || videoEditAnnotationColor(mark) === 'yellow' ? VIDEO_EDIT_ANNOTATION_COLORS.black : VIDEO_EDIT_ANNOTATION_COLORS.white
      context.fillText(String(target.number), at[0], at[1] + radius * 0.05)
      context.textAlign = 'start'; context.textBaseline = 'alphabetic'
    }
    if (target.kind === 'text') {
      // 文字批注直接把说明写在画面上：浅底保证压在任何画面上都读得清，左侧一条色条表明颜色。
      const at = transform(target.x, target.y); const size = Math.max(14, Math.round(width / 60))
      context.setLineDash([]); context.font = `500 ${size}px sans-serif`
      const text = mark.text.length > 60 ? `${mark.text.slice(0, 59)}…` : mark.text
      const boxWidth = Math.min(width - at[0], context.measureText(text).width + size * 1.2); const boxHeight = size * 1.6
      context.fillStyle = VIDEO_EDIT_ANNOTATION_COLORS.white; context.globalAlpha = 0.92; context.fillRect(at[0], at[1], boxWidth, boxHeight); context.globalAlpha = 1
      context.fillStyle = color; context.fillRect(at[0], at[1], Math.max(3, size / 5), boxHeight)
      context.fillStyle = VIDEO_EDIT_ANNOTATION_COLORS.black; context.fillText(text, at[0] + size * 0.6, at[1] + size * 1.15)
      label = [at[0], at[1]]
    }
    const title = `${number}${mark.status === 'addressed' ? ' 已改完' : ''}${target.kind === 'element' && !target.region ? ' 元素已不存在' : ''}`
    context.setLineDash([]); context.font = '14px sans-serif'; context.fillStyle = token('media'); const x = Math.max(0, Math.min(width - 24, label[0])); const y = Math.max(20, Math.min(height, label[1]))
    context.fillRect(x, y - 20, Math.min(width - x, context.measureText(title).width + 8), 20)
    context.fillStyle = token('on-media'); context.fillText(title, x + 4, y - 5)
  }
  context.restore()
}
