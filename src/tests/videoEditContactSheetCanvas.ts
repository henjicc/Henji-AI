import sharp from 'sharp'
import { BLACK_HEX } from '@/core/theme/colorTokens'

/** Node GPU tests use libvips for the Canvas2D boundary, not a browser/GPU canvas. */
export class ContactSheetBitmap {
  closed = false
  closes = 0
  constructor(readonly pixels: Uint8Array, readonly width: number, readonly height: number) {}
  close(): void { this.closed = true; this.closes++ }
}

export class ContactSheetCanvas {
  private operations: Array<Promise<{ input: Buffer; left: number; top: number }>> = []
  readonly labels: string[] = []
  constructor(readonly width: number, readonly height: number) {}
  getContext() {
    const operations = this.operations; const labels = this.labels
    return {
      fillStyle: BLACK_HEX, font: '12px sans-serif', textBaseline: 'top', imageSmoothingQuality: 'low',
      drawImage(bitmap: ContactSheetBitmap, x: number, y: number, width: number, height: number) {
        if (bitmap.closed) throw new Error('绘制前位图已关闭')
        // Own the pixels at draw time; subsequent close/reuse must not affect the sheet.
        const copy = Buffer.from(bitmap.pixels)
        operations.push(sharp(copy, { raw: { width: bitmap.width, height: bitmap.height, channels: 4 } }).resize(width, height).png().toBuffer().then(input => ({ input, left: x, top: y })))
      },
      fillRect(x: number, y: number, width: number, height: number) {
        operations.push(sharp({ create: { width: Math.ceil(width), height, channels: 4, background: this.fillStyle } }).png().toBuffer().then(input => ({ input, left: x, top: y })))
      },
      measureText(text: string) { return { width: text.length * Number.parseInt(this.font) * .65 } },
      fillText(text: string, x: number, y: number) {
        labels.push(text)
        const size = Number.parseInt(this.font)
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(text.length * size * .65)}" height="${size + 4}"><text x="0" y="${size}" font-size="${size}" fill="${this.fillStyle}" font-family="sans-serif">${text}</text></svg>`
        operations.push(Promise.resolve({ input: Buffer.from(svg), left: x, top: y }))
      },
    }
  }
  async convertToBlob(): Promise<Blob> {
    const data = await sharp({ create: { width: this.width, height: this.height, channels: 4, background: BLACK_HEX } }).composite(await Promise.all(this.operations)).png().toBuffer()
    return new Blob([new Uint8Array(data)], { type: 'image/png' })
  }
}
