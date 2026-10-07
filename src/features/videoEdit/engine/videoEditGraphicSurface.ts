import type { VideoEditGraphicDraw } from '@/core/videoEdit/graphics'
import { paintVideoEditText } from './videoEditTextSurface'

/** Structured graphics use the same rasterizer for preview, export and frame observation. */
export function paintVideoEditGraphic(context: OffscreenCanvasRenderingContext2D, draws: readonly VideoEditGraphicDraw[], width: number, height: number): void {
  for (const draw of draws) {
    const command = draw.command
    context.save(); context.translate(draw.pivotX, draw.pivotY); context.rotate(draw.rotation * Math.PI / 180); context.scale(draw.scale ?? 1, draw.scale ?? 1); context.translate(-draw.pivotX, -draw.pivotY)
    if (command.kind === 'text') {
      if (!draw.textStyle) throw new Error('图形文字缺少共享样式。')
      const layer = new OffscreenCanvas(width, height)
      paintVideoEditText(layer.getContext('2d')!, { text: command.text, textStyle: draw.textStyle }, width, height, command)
      context.globalAlpha = draw.opacity ?? 1; context.drawImage(layer, 0, 0)
    } else if (command.kind === 'rect' || command.kind === 'ellipse') {
      const [r, g, b, a] = command.fill
      context.fillStyle = `rgb(${r * 255} ${g * 255} ${b * 255} / ${a})`
      context.beginPath()
      if (command.kind === 'rect') context.roundRect(command.x, command.y, command.width, command.height, command.radius ?? 0)
      else context.ellipse(command.x + command.width / 2, command.y + command.height / 2, command.width / 2, command.height / 2, 0, 0, Math.PI * 2)
      context.fill()
    } else throw new Error('基本图形只接受文字、矩形和椭圆。')
    context.restore()
  }
}
