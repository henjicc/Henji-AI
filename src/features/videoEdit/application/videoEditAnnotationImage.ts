import { videoEditAnnotationAt, videoEditAnnotationBounds, type VideoEditAnnotation } from '@/core/videoEdit/annotations'

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
/** Overlay coordinates use the same normalized targets as the monitor, remapped into a cropped image. */
export function paintVideoEditAnnotationObservation(context: Context, width: number, height: number, overlays: ReturnType<typeof prepareVideoEditAnnotationObservation>['overlays'], crop?: { x: number; y: number; width: number; height: number }): void {
  const css = getComputedStyle(document.documentElement)
  const color = (token: string): string => `rgb(${css.getPropertyValue(`--${token}-rgb`).trim()})`
  const transform = (x: number, y: number): [number, number] => [(x - (crop?.x ?? 0)) / (crop?.width ?? 1) * width, (y - (crop?.y ?? 0)) / (crop?.height ?? 1) * height]
  context.save()
  for (const { mark, number } of overlays) {
    const target = mark.target
    context.strokeStyle = color(mark.status === 'addressed' ? 'success' : mark.status === 'open' ? 'accent' : 'on-media')
    context.lineWidth = Math.max(2, width / 640); context.setLineDash(mark.status === 'draft' ? [6, 4] : [])
    let label: [number, number] = [8, 20 + (number - 1) * 24]
    if (target.kind === 'point') { label = transform(target.x, target.y); context.beginPath(); context.arc(...label, 6, 0, Math.PI * 2); context.stroke() }
    const box = target.kind === 'region' ? target : target.kind === 'element' ? target.region : undefined
    if (box) { label = transform(box.x, box.y); context.strokeRect(...label, box.width / (crop?.width ?? 1) * width, box.height / (crop?.height ?? 1) * height) }
    if (target.kind === 'stroke') for (const stroke of target.strokes) {
      context.beginPath(); stroke.forEach((point, index) => { const at = transform(point.x, point.y); if (!index) { context.moveTo(...at); label = at } else context.lineTo(...at) }); context.stroke()
    }
    const title = `${number}${mark.status === 'addressed' ? ' 待审查' : ''}${target.kind === 'element' && !target.region ? ' 元素已不存在' : ''}`
    context.font = '14px sans-serif'; context.fillStyle = color('media'); const x = Math.max(0, Math.min(width - 24, label[0])); const y = Math.max(20, Math.min(height, label[1]))
    context.fillRect(x, y - 20, Math.min(width - x, context.measureText(title).width + 8), 20)
    context.fillStyle = color('on-media'); context.fillText(title, x + 4, y - 5)
  }
  context.restore()
}
