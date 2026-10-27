import { expect, it, vi } from 'vitest'
import type { NativeImage, Rectangle, WebContents } from 'electron'
import { CAPTURE_TOKEN_COLORS } from '../../../../../packages/web-replay-probe/src/replay/types'
import { coverToken, onlyToken, PaintFrameCapture, tokenAt, tokenIndex, tokenSidePx, unionRect } from './capture'

const bgra = (rgb: readonly number[]): Buffer => Buffer.from([rgb[2], rgb[1], rgb[0], 255])

it('按调色板认出帧标记，容得下少量色差，别的颜色不算', () => {
  CAPTURE_TOKEN_COLORS.forEach((color, index) => expect(tokenAt(bgra(color))).toBe(index))
  expect(tokenAt(bgra([235, 20, 240]))).toBe(0)
  expect(tokenAt(bgra([255, 255, 255]))).toBe(-1)
  expect(tokenAt(bgra([128, 0, 128]))).toBe(-1)
  expect([0, 1, 4, 7].map(tokenIndex)).toEqual([0, 1, 0, 3])
  expect([1, 1.5, 3].map(tokenSidePx)).toEqual([3, 4, 7])
})

it('用右边相邻的像素盖掉左上角的帧标记，其余像素不动', () => {
  const width = 6, height = 3, side = 2
  const bitmap = Buffer.alloc(width * height * 4)
  for (let p = 0; p < width * height; p += 1) bitmap.fill(p, p * 4, p * 4 + 4)
  const before = Buffer.from(bitmap)
  coverToken(bitmap, width, height, side)
  const px = (buffer: Buffer, x: number, y: number): number => buffer[(y * width + x) * 4]
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) expect(px(bitmap, x, y)).toBe(px(before, x + side, y))
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (y >= 2 || x >= 2) expect(px(bitmap, x, y)).toBe(px(before, x, y))
})

it('只有帧标记重画才算画面没变；合并期间所有重画的范围', () => {
  expect(onlyToken({ x: 0, y: 0, width: 7, height: 7 }, 7)).toBe(true)
  expect(onlyToken({ x: 0, y: 0, width: 8, height: 7 }, 7)).toBe(false)
  expect(onlyToken({ x: 100, y: 0, width: 1, height: 1 }, 7)).toBe(false)
  expect(unionRect({ x: 0, y: 0, width: 7, height: 7 }, { x: 10, y: 20, width: 5, height: 5 })).toEqual({ x: 0, y: 0, width: 15, height: 25 })
})

function paints(): { contents: WebContents; paint: (token: number, dirty: Rectangle) => void } {
  let listener: ((event: unknown, dirty: Rectangle, image: NativeImage) => void) | null = null
  const contents = { on: (_name: string, callback: typeof listener) => { listener = callback } } as unknown as WebContents
  const paint = (token: number, dirty: Rectangle): void => {
    const pixel = token < 0 ? Buffer.from([255, 255, 255, 255]) : bgra(CAPTURE_TOKEN_COLORS[token])
    const image = { crop: () => ({ toBitmap: () => pixel }), getSize: () => ({ width: 10, height: 10 }), token } as unknown as NativeImage
    listener?.(null, dirty, image)
  }
  return { contents, paint }
}

it('只交出带本帧标记的画面：之前的画面跳过，但它们重画过的范围算进这一帧', async () => {
  const { contents, paint } = paints()
  const capture = new PaintFrameCapture(7)
  capture.attach(contents)
  paint(3, { x: 0, y: 0, width: 7, height: 7 }) // 上一帧的标记还在：鼠标移动带来的重画
  paint(3, { x: 300, y: 200, width: 20, height: 20 })
  const pending = capture.take(0, 1_000)
  paint(0, { x: 0, y: 0, width: 7, height: 7 })
  const shot = await pending
  expect(shot!.dirty).toEqual({ x: 0, y: 0, width: 320, height: 220 })
  expect(shot!.changed).toBe(true)
  // 之后同一标记的画面不再被当作下一帧
  paint(0, { x: 0, y: 0, width: 7, height: 7 })
  vi.useFakeTimers()
  const missing = capture.take(1, 500)
  await vi.advanceTimersByTimeAsync(600)
  expect(await missing).toBeNull()
  vi.useRealTimers()
  // 标记被盖住时退而取最新的画面；只重画了标记，画面算没变
  const latest = await capture.takeLatest()
  expect(latest?.dirty).toEqual({ x: 0, y: 0, width: 7, height: 7 })
  expect(latest?.changed).toBe(false)
  expect(await capture.takeLatest()).toBeNull()
})
