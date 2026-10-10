import type { VectorPaint } from '@/core/imaging/vectorContent'

/** One appearance compositor for text, paths, titles and captions. Outlines are geometry adapters. */
export function paintVectorAppearance(context: OffscreenCanvasRenderingContext2D, width: number, height: number, resolution: number, paint: VectorPaint, drawCoverage: (target: OffscreenCanvasRenderingContext2D) => void, drawOutline: (target: OffscreenCanvasRenderingContext2D, radius: number) => void): void {
  const mask = new OffscreenCanvas(Math.ceil(width * resolution), Math.ceil(height * resolution))
  const maskContext = mask.getContext('2d')!
  maskContext.scale(resolution, resolution); drawCoverage(maskContext)
  const layer = new OffscreenCanvas(mask.width, mask.height), ink = layer.getContext('2d')!
  ink.scale(resolution, resolution)
  const reset = (): void => { ink.clearRect(0, 0, width, height); ink.globalCompositeOperation = 'source-over'; ink.globalAlpha = 1; ink.filter = 'none' }
  const tint = (color: string): void => { ink.globalCompositeOperation = 'source-in'; ink.fillStyle = color; ink.fillRect(0, 0, width, height); ink.globalCompositeOperation = 'source-over' }
  context.save()
  for (const shadow of paint.shadows) if (shadow.enabled && shadow.opacity) {
    reset(); if(paint.fill.enabled || !paint.strokes.some(stroke => stroke.enabled && stroke.width)){ink.drawImage(mask, 0, 0, width, height);if(shadow.size)drawOutline(ink,shadow.size)}
    for(const stroke of paint.strokes)if(stroke.enabled&&stroke.width)drawOutline(ink,stroke.width*(stroke.position==='center'?.5:1)+shadow.size)
    tint(shadow.color)
    const radians = shadow.angle * Math.PI / 180
    context.globalAlpha = shadow.opacity; context.filter = `blur(${shadow.blur * resolution}px)`
    context.drawImage(layer, Math.cos(radians) * shadow.distance, Math.sin(radians) * shadow.distance, width, height)
    context.filter = 'none'; context.globalAlpha = 1
  }
  if (paint.fill.enabled) { reset(); ink.drawImage(mask, 0, 0, width, height); tint(paint.fill.color); context.drawImage(layer, 0, 0, width, height) }
  const extent = (stroke: VectorPaint['strokes'][number]): number => stroke.position === 'inside' ? 0 : stroke.width * (stroke.position === 'center' ? .5 : 1)
  for (const stroke of paint.strokes.filter(item => item.enabled && item.width).sort((a, b) => extent(b) - extent(a) || b.width - a.width)) {
    reset(); drawOutline(ink, stroke.position === 'center' ? stroke.width / 2 : stroke.width)
    if (stroke.position !== 'center') { ink.globalCompositeOperation = stroke.position === 'inside' ? 'destination-in' : 'destination-out'; ink.drawImage(mask, 0, 0, width, height) }
    tint(stroke.color); context.drawImage(layer, 0, 0, width, height)
  }
  context.restore()
}
