import { nativeImage, type NativeImage, type Rectangle, type WebContents } from 'electron'
import { CAPTURE_TOKEN_COLORS, CAPTURE_TOKEN_CSS_PX } from '../../../../../packages/web-replay-probe/src/replay/types'
import type { FrameSource, TakenFrame } from './frameSource'

/** Whose token a pixel (B, G, R in that order, as in the bitmap) shows, or -1. */
export function tokenAt(bgra: Uint8Array, offset = 0): number {
  const rgb = [bgra[offset + 2], bgra[offset + 1], bgra[offset]]
  return CAPTURE_TOKEN_COLORS.findIndex(color => color.every((value, channel) => Math.abs(value - rgb[channel]) <= 40))
}

export function tokenIndex(frame: number): number { return frame % CAPTURE_TOKEN_COLORS.length }

/** Device pixels the token square covers (with a pixel of antialiasing on its far edges). */
export function tokenSidePx(dpr: number): number { return Math.ceil(CAPTURE_TOKEN_CSS_PX * dpr) + 1 }

/**
 * Paints over the token square with the pixels right of it, row by row (the page's own pixels there are
 * hidden under the token; its neighbours are the same background in practice).
 */
export function coverToken(bitmap: Buffer, width: number, height: number, side: number): void {
  const rows = Math.min(side, height)
  const cols = Math.min(side, Math.max(0, width - side))
  for (let y = 0; y < rows; y += 1) {
    const row = y * width * 4
    bitmap.copy(bitmap, row, row + side * 4, row + side * 4 + cols * 4)
  }
}

export function unionRect(a: Rectangle | null, b: Rectangle): Rectangle {
  if (!a) return { ...b }
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** Damage that touches nothing but the token square: the picture is the previous one. */
export function onlyToken(dirty: Rectangle, side: number): boolean {
  return dirty.x >= 0 && dirty.y >= 0 && dirty.x + dirty.width <= side && dirty.y + dirty.height <= side
}

/** A small JPEG data URL of a picture for the live preview, token painted over. */
export function previewJpegOf(image: NativeImage, side: number): string {
  const width = image.getSize().width
  const small = image.resize({ width: Math.min(1280, width) })
  const size = small.getSize()
  const bitmap = small.toBitmap()
  coverToken(bitmap, size.width, size.height, Math.ceil(side * size.width / width) + 1)
  return `data:image/jpeg;base64,${nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height }).toJPEG(80).toString('base64')}`
}

interface Paint { image: NativeImage; dirty: Rectangle; token: number }

/**
 * The CPU way: collects the offscreen window's paint images and hands back the one that shows a given
 * frame. The frame's capture token, set in the same rendering update as the frame's state, must be in
 * the picture; earlier pictures (input-only repaints, the previous frame) are skipped, their damage kept.
 */
export class PaintFrameCapture implements FrameSource {
  private paints: Paint[] = []
  /** Damage of paints already dropped since the last taken frame. */
  private carried: Rectangle | null = null
  private wake: (() => void) | null = null
  private hasPicture = false
  received = 0

  constructor(private readonly side: number) {}

  attach(contents: WebContents): void {
    contents.on('paint', (_event, dirty, image) => {
      this.received += 1
      // The token sits in the top-left pixel; reading one pixel costs microseconds, unlike the whole 4K frame.
      const pixel = image.crop({ x: 0, y: 0, width: 1, height: 1 }).toBitmap()
      this.paints.push({ image, dirty, token: pixel.length >= 4 ? tokenAt(pixel) : -1 })
      // Each paint holds a full frame (38 MB at 4K); keep only the newest few, their damage carried over.
      if (this.paints.length > 6) this.carried = unionRect(this.carried, this.paints.shift()!.dirty)
      this.wake?.()
    })
  }

  private takeAt(index: number): TakenFrame {
    let dirty = this.carried
    for (let k = 0; k <= index; k += 1) dirty = unionRect(dirty, this.paints[k].dirty)
    const { image } = this.paints[index]
    this.paints = this.paints.slice(index + 1)
    this.carried = null
    const damage = dirty!
    const changed = !this.hasPicture || !onlyToken(damage, this.side)
    this.hasPicture = true
    const side = this.side
    const size = image.getSize()
    return {
      dirty: damage, changed, width: size.width, height: size.height, format: 'bgra',
      bitmap: () => {
        const bitmap = image.toBitmap()
        // The paint image is already in device pixels at the offscreen deviceScaleFactor.
        coverToken(bitmap, size.width, Math.floor(bitmap.length / 4 / size.width), side)
        return bitmap
      },
      previewJpeg: () => previewJpegOf(image, side),
    }
  }

  async take(token: number, timeoutMs: number): Promise<TakenFrame | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const index = this.paints.findIndex(paint => paint.token === token)
      if (index >= 0) return this.takeAt(index)
      const left = deadline - Date.now()
      if (left <= 0) return null
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.wake = null; resolve() }, left)
        this.wake = () => { clearTimeout(timer); this.wake = null; resolve() }
      })
    }
  }

  async takeLatest(): Promise<TakenFrame | null> { return this.paints.length ? this.takeAt(this.paints.length - 1) : null }

  discard(): void { this.paints = []; this.carried = null }

  stats(): Record<string, number> { return { paints: this.received } }

  async dispose(): Promise<void> { this.discard() }
}
