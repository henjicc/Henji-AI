import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { on: vi.fn() }, nativeImage: {}, session: {}, sharedTexture: {} }))
import type { WebContents } from 'electron'
import { coverTokenNv12, GpuCaptureError, GpuFrameCapture } from './gpuCapture'

it('NV12 画面里用右边相邻的像素盖掉左上角帧标记（亮度与色度两个平面），其余不动', () => {
  const width = 16, height = 8, side = 3
  const picture = Buffer.alloc(width * height * 3 / 2)
  for (let i = 0; i < picture.length; i += 1) picture[i] = i % 251
  const before = Buffer.from(picture)
  coverTokenNv12(picture, width, height, side)
  for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) expect(picture[y * width + x]).toBe(before[y * width + x + side])
  // 色度：标记覆盖 ceil(3/2)=2 对 U、V（4 个字节）、2 行
  const chroma = width * height
  for (let y = 0; y < 2; y += 1) for (let b = 0; b < 4; b += 1) expect(picture[chroma + y * width + b]).toBe(before[chroma + y * width + b + 4])
  expect(picture.subarray(side * width, chroma)).toEqual(before.subarray(side * width, chroma))
  expect(picture.subarray(chroma + 2 * width)).toEqual(before.subarray(chroma + 2 * width))
})

it('画面不带共享纹理时取帧立刻报 GpuCaptureError，交给 CPU 采集重来，不等满超时', async () => {
  let paint: ((event: { texture?: unknown }) => void) | undefined
  const contents = { on: (name: string, listener: typeof paint) => { if (name === 'paint') paint = listener } } as unknown as WebContents
  const capture = new GpuFrameCapture(3)
  capture.attach(contents)
  const waiting = capture.take(0, 60_000)
  paint!({})
  await expect(waiting).rejects.toBeInstanceOf(GpuCaptureError)
  await expect(capture.takeLatest()).rejects.toBeInstanceOf(GpuCaptureError)
})
