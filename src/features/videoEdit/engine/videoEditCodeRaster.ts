import {paintMeasuredText} from '@/services/vectorContent/textRaster'
import { polylinePath, traceVectorPath } from '@/core/imaging/vectorContent'
import { CodeMaterialError, type CodeColor, type CodeDrawCommand, type CodePaint } from '@/core/videoEdit/codeMaterial/contract'
import { codeLocalBounds, trimCodePath } from '@/core/videoEdit/codeMaterial/geometry'

function cssColor(color: CodeColor): string { return `rgba(${color[0] * 255},${color[1] * 255},${color[2] * 255},${color[3]})` }
function canvasPaint(context: OffscreenCanvasRenderingContext2D, paint: CodePaint): string | CanvasGradient {
  if (Array.isArray(paint)) return cssColor(paint)
  const gradient = paint.kind === 'linearGradient' ? context.createLinearGradient(paint.x1!, paint.y1!, paint.x2!, paint.y2!) : paint.kind === 'conicGradient' ? context.createConicGradient((paint.angle ?? 0) * Math.PI / 180, paint.cx!, paint.cy!) : context.createRadialGradient(paint.cx!, paint.cy!, 0, paint.cx!, paint.cy!, paint.r!)
  paint.stops.forEach(([offset, color]) => gradient.addColorStop(offset, cssColor(color))); return gradient
}
/** No blur/shadow/filter is run on Canvas. Rasterization is cached and independent of animation transforms. */
export function rasterizeCodeShape(command: CodeDrawCommand, image: { x: number; y: number; width: number; height: number; resolution?: number }): OffscreenCanvas {
  const canvas = new OffscreenCanvas(Math.ceil(image.width * (image.resolution ?? 1)), Math.ceil(image.height * (image.resolution ?? 1))); const context = canvas.getContext('2d')
  if (!context) throw new CodeMaterialError('CONTEXT', '无法创建代码图形栅格环境。')
  if ((image.resolution ?? 1) !== 1) context.scale(image.resolution!, image.resolution!)
  context.translate(-image.x, -image.y)
  context.fillStyle = canvasPaint(context, command.paint ?? ('fill' in command ? command.fill : 'color' in command ? command.color : [1, 1, 1, 1]))
  if (command.stroke) context.strokeStyle = canvasPaint(context, command.stroke)
  context.lineWidth = command.strokeWidth ?? (command.kind === 'line' ? command.width : 0); context.lineCap = command.lineCap ?? 'butt'; context.lineJoin = command.lineJoin ?? 'miter'
  context.setLineDash(command.dash ?? [])
  if (command.kind === 'text') {
    if (!command.layout) throw new CodeMaterialError('CONTEXT', '文字缺少共享度量。')
    paintMeasuredText(context,command.layout,codeLocalBounds(command),command.layout.fontSize*(command.lineHeight??1.2),command.align??'left',Boolean(command.letterSpacing),command.stroke?command.strokeWidth:0)
    return canvas
  }
  context.beginPath()
  if (command.kind === 'rect') context.roundRect(command.x, command.y, command.width, command.height, command.radii ?? command.radius)
  else if (command.kind === 'ellipse') context.ellipse(command.x + command.width / 2, command.y + command.height / 2, command.width / 2, command.height / 2, 0, 0, Math.PI * 2)
  else if (command.kind === 'line' || command.kind === 'path') {
    const paths = command.kind === 'path' ? command.points : [[[command.x1, command.y1], [command.x2, command.y2]] as [number, number][]]
    for (const path of paths) { if (!path.length) continue; traceVectorPath(context,polylinePath(path.map(([x,y])=>({x,y})),command.kind === 'path' && command.closed)) }
    if (command.kind === 'path') context.fill()
    context.beginPath()
    for (const path of trimCodePath(paths, command.trimStart, command.trimEnd)) traceVectorPath(context,polylinePath(path.map(([x,y])=>({x,y}))))
    if (command.kind === 'line') context.strokeStyle = canvasPaint(context, command.stroke ?? command.color)
    if (command.kind === 'line' || command.stroke && command.strokeWidth) context.stroke()
    return canvas
  } else throw new CodeMaterialError('TYPE', '此图形不能栅格化。')
  context.fill(); if (command.stroke && command.strokeWidth) context.stroke(); return canvas
}

