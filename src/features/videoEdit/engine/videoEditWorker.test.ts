import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import type { RenderRequest, RenderResponse } from './videoEditWorker'
import type { VideoEditPresentationCapture } from './videoEditGpuCompositor'

const state = vi.hoisted(() => ({ render: vi.fn(), readRgb: vi.fn() }))
vi.mock('./videoEditRenderer', () => ({ VideoEditRenderer: class {
  constructor(readonly document: unknown) {}
  render = state.render
  async dispose() {}
  cancelPresentation() {}
  codeDiagnostics() { return {} }
  codePerformance() { return [] }
} }))
vi.mock('./videoEditTrackingPixels', () => ({ readVideoEditTrackingRgb: state.readRgb }))

const document = createVideoEditTestDocument('联系表回读')
const composition = videoEditComposition(document, document.sequences[0].id)
const messages: RenderResponse[] = []
const postMessage = vi.fn((message: RenderResponse) => { messages.push(message) })
const worker = { onmessage: undefined as unknown as (event: { data: RenderRequest }) => void, postMessage }
const bitmap = () => ({ width: 1920, height: 1080, close: vi.fn() }) as unknown as ImageBitmap
let nextId = 0
async function send(request: Omit<Extract<RenderRequest, { kind: 'render' }>, 'id'>): Promise<RenderResponse> {
  const id = ++nextId
  worker.onmessage({ data: { ...request, id } })
  await vi.waitFor(() => expect(messages.some(message => message.id === id && !message.phase)).toBe(true))
  return messages.find(message => message.id === id && !message.phase)!
}
async function init(direct = false): Promise<void> {
  const id = ++nextId
  worker.onmessage({ data: { kind: 'init', id, document: composition, ...(direct ? { surface: {} as OffscreenCanvas } : {}) } })
  await vi.waitFor(() => expect(messages.some(message => message.id === id)).toBe(true))
}
beforeEach(async () => {
  vi.stubGlobal('self', worker)
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap()))
  postMessage.mockClear(); state.render.mockReset(); messages.length = 0
  state.readRgb.mockReset().mockReturnValue(new Uint8Array([1, 2, 3]))
  await import('./videoEditWorker')
  await init()
})
afterEach(() => { vi.unstubAllGlobals() })

function render(pixels: ImageBitmap, completion: Promise<void> = Promise.resolve(), presented = true): void {
  void completion.catch(() => {})
  state.render.mockImplementation(async (...args: unknown[]) => {
    const capture = args[7] as VideoEditPresentationCapture | undefined
    capture?.(Promise.resolve(pixels))
    // Simulates canvas expiry during the asynchronous GPU completion wait.
    return { presented, completion, canvas: { transferToImageBitmap() { throw new Error('画布纹理已过期') } }, gpuMs: 0 }
  })
}
const request = { kind: 'render', frame: 15, sequential: false } as const

it('联系表/单帧/试渲染在同次提交捕获全尺寸像素，不读已过期的画布', async () => {
  const pixels = bitmap(); render(pixels)
  const result = await send(request)
  expect(result).toMatchObject({ presented: true, bitmap: pixels })
  expect(result.error).toBeUndefined()
  expect((state.render.mock.calls[0][7] as VideoEditPresentationCapture).maxPixels).toBe(Infinity)
  expect(pixels.close).not.toHaveBeenCalled()
  expect(postMessage.mock.lastCall?.[0].bitmap).toBe(pixels)
})

it('直接预览不回读；历史图保持预算，离屏同时索取历史图不缩小正式帧', async () => {
  await init(true)
  const pixels = bitmap(); render(pixels)
  expect((await send(request)).bitmap).toBeUndefined()
  expect(state.render.mock.lastCall?.[7]).toBeUndefined()
  expect((await send({ ...request, history: true })).history).toBe(pixels)
  expect((state.render.mock.lastCall?.[7] as VideoEditPresentationCapture).maxPixels).toBe(1280 * 720)
  await init()
  const both = await send({ ...request, history: true })
  expect(both.bitmap).toBe(pixels); expect(both.history).not.toBe(pixels)
  expect(createImageBitmap).toHaveBeenCalledWith(pixels, { resizeWidth: 1280, resizeHeight: 720, resizeQuality: 'high' })
})

it('RGB 分析也从稳定快照读取，并释放不向调用方移交的位图', async () => {
  const pixels = bitmap(); render(pixels)
  const result = await send({ ...request, readRgb: { width: 1, height: 1 } })
  expect(result.rgb).toEqual(new Uint8Array([1, 2, 3]))
  expect(state.readRgb).toHaveBeenCalledWith(pixels, { width: 1, height: 1 })
  expect(result.bitmap).toBeUndefined(); expect(pixels.close).toHaveBeenCalledOnce()
})

it('GPU 完成失败、取消呈现和发送失败都关闭快照，不回报黑帧成功', async () => {
  const failed = bitmap()
  render(failed, Promise.resolve().then(() => { throw new Error('GPU 失败') }))
  expect((await send(request)).error).toContain('GPU 失败')
  await vi.waitFor(() => expect(failed.close).toHaveBeenCalledOnce())
  const cancelled = bitmap(); render(cancelled, Promise.resolve(), false)
  expect((await send(request)).bitmap).toBeUndefined(); expect(cancelled.close).toHaveBeenCalledOnce()
  const unsent = bitmap(); render(unsent)
  postMessage.mockImplementationOnce(() => { throw new Error('发送失败') })
  expect((await send(request)).error).toContain('发送失败'); expect(unsent.close).toHaveBeenCalledOnce()
})
