import sharp from 'sharp'
import type { CodeDrawCommand, CodePaint } from '@/core/videoEdit/codeMaterial/contract'
import { trimCodePath } from '@/core/videoEdit/codeMaterial/geometry'
const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const color = (paint: number[]): string => `rgba(${paint[0] * 255},${paint[1] * 255},${paint[2] * 255},${paint[3]})`
/** Native libvips SVG raster fixture isolates GPU compositing/effects; Canvas API/layout is tested separately. */
export async function rasterFixture(command: CodeDrawCommand, image: { x: number; y: number; width: number; height: number; resolution?: number }): Promise<OffscreenCanvas> {
  if (command.paint && !Array.isArray(command.paint) && command.paint.kind === 'conicGradient') {
    const gradient = command.paint; const width = image.width; const height = image.height; const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = image.x + x + .5; const py = image.y + y + .5
      if (command.kind !== 'rect' || px < command.x || px > command.x + command.width || py < command.y || py > command.y + command.height) continue
      const at = ((Math.atan2(py - gradient.cy!, px - gradient.cx!) / (Math.PI * 2) - (gradient.angle ?? 0) / 360) % 1 + 1) % 1
      const right = gradient.stops.findIndex(stop => stop[0] > at)
      const b = gradient.stops[right < 0 ? gradient.stops.length - 1 : right]; const a = gradient.stops[Math.max(0, right < 0 ? gradient.stops.length - 1 : right - 1)]
      const amount = a[0] === b[0] ? 0 : (at - a[0]) / (b[0] - a[0]); const c = a[1].map((v, i) => v + (b[1][i] - v) * amount)
      pixels.set([c[0] * c[3] * 255, c[1] * c[3] * 255, c[2] * c[3] * 255, c[3] * 255].map(Math.round), (y * width + x) * 4)
    }
    return { pixels, width, height } as unknown as OffscreenCanvas
  }
  const definitions: string[] = []
  const paint = (value: CodePaint): string => {
    if (Array.isArray(value)) return color(value)
    const id = `g${definitions.length}`; const stops = value.stops.map(([at, ink]) => `<stop offset="${at}" stop-color="${color(ink)}"/>`).join('')
    definitions.push(value.kind === 'linearGradient' ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${value.x1}" y1="${value.y1}" x2="${value.x2}" y2="${value.y2}">${stops}</linearGradient>` : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${value.cx}" cy="${value.cy}" r="${value.r}">${stops}</radialGradient>`)
    return `url(#${id})`
  }
  const fill = paint(command.paint ?? ('fill' in command ? command.fill : 'color' in command ? command.color : [1, 1, 1, 1]))
  const stroke = command.stroke ? `stroke="${paint(command.stroke)}" stroke-width="${command.strokeWidth ?? 0}"` : ''
  let geometry = ''
  const lineStyle = `stroke-linecap="${command.lineCap ?? 'butt'}" stroke-linejoin="${command.lineJoin ?? 'miter'}" stroke-dasharray="${command.dash?.join(' ') || 'none'}"`
  if (command.kind === 'line') geometry = `<path d="${trimCodePath([[[command.x1,command.y1],[command.x2,command.y2]]],command.trimStart,command.trimEnd).map(path=>path.map(([x,y],i)=>`${i?'L':'M'}${x},${y}`).join(' ')).join(' ')}" fill="none" stroke="${paint(command.stroke ?? command.color)}" stroke-width="${command.strokeWidth ?? command.width}" ${lineStyle}/>`
  if (command.kind === 'rect') geometry = `<rect x="${command.x}" y="${command.y}" width="${command.width}" height="${command.height}" rx="${command.radius}" fill="${fill}" ${stroke}/>`
  if (command.kind === 'ellipse') geometry = `<ellipse cx="${command.x + command.width / 2}" cy="${command.y + command.height / 2}" rx="${command.width / 2}" ry="${command.height / 2}" fill="${fill}" ${stroke}/>`
  if (command.kind === 'path') geometry = `<path d="${command.points.map(path => path.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + (command.closed ? ' Z' : '')).join(' ')}" fill="${fill}" ${stroke}/>`
  if (command.kind === 'text') geometry = `<text x="${command.x}" y="${command.y + command.fontSize * .3}" font-size="${command.fontSize}" font-family="sans-serif" fill="${fill}" ${stroke}>${escape(command.text)}</text>`
  const width = image.width * (image.resolution ?? 1); const height = image.height * (image.resolution ?? 1)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${image.x} ${image.y} ${image.width} ${image.height}"><defs>${definitions.join('')}</defs>${geometry}</svg>`
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  // The GPU stores premultiplied pixels, as production copyExternalImageToTexture requests.
  for (let i = 0; i < data.length; i += 4) { const a = data[i + 3] / 255; data[i] = Math.round(data[i] * a); data[i + 1] = Math.round(data[i + 1] * a); data[i + 2] = Math.round(data[i + 2] * a) }
  return { pixels: data, width, height } as unknown as OffscreenCanvas
}

export { color as rasterColor }
