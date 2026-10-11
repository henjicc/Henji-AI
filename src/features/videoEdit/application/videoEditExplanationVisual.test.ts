// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { captureExplanationPixels, retainExplanationPixels } from './videoEditExplanationVisual'

afterEach(() => { vi.unstubAllGlobals() })
it('只读取同一回执的历史位图；后续画面不改变已同步复制的历史，旧图和关闭图释放', async () => {
  const monitor = document.createElement('div'); const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-label', '剪辑画面'); canvas.dataset.presentedFrame = '30'; monitor.append(canvas)
  const draw = vi.fn(); const encoded = new Uint8Array([1, 2, 3])
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage: draw } } async convertToBlob() { return { arrayBuffer: async () => encoded.buffer } } })
  const first = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap
  const next = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap
  expect(captureExplanationPixels(monitor, 30)).toBeUndefined()
  retainExplanationPixels(canvas, 30, first)
  const historical = captureExplanationPixels(monitor, 30)
  expect(draw).toHaveBeenCalledWith(first, 0, 0, 1280, 720)
  retainExplanationPixels(canvas, 40, next); canvas.dataset.presentedFrame = '40'
  expect(first.close).toHaveBeenCalledOnce(); expect(captureExplanationPixels(monitor, 30)).toBeUndefined()
  expect(await historical).toEqual({ bytes: encoded, size: [1280, 720] })
  retainExplanationPixels(canvas, -1); expect(next.close).toHaveBeenCalledOnce()
  expect(captureExplanationPixels(monitor, 40)).toBeUndefined()
})
