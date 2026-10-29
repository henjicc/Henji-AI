import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import type { DocumentHoverFrames, WriteDocumentHoverFrameRequest } from '@/core/documents/types'
import type { VideoEditComposition, VideoEditDocument } from '@/core/videoEdit/document'
import { VideoEditHoverFrameBuilder, startVideoEditHoverFrames } from './videoEditHoverFrames'
import { loadVideoEditHoverPreview, videoEditHoverContentKey, videoEditHoverPositions } from './videoEditHoverPreview'
import type { VideoEditInstance } from './videoEditService'

const state = vi.hoisted(() => ({ stored: null as DocumentHoverFrames | null, writes: [] as WriteDocumentHoverFrameRequest[], instances: [] as VideoEditInstance[], gesture: false, domain: () => {}, view: () => {} }))
vi.mock('@/commands/documents', () => ({
  getDocumentHoverFrames: vi.fn(async () => state.stored),
  writeDocumentHoverFrame: vi.fn(async (request: WriteDocumentHoverFrameRequest) => {
    state.writes.push(request)
    if (!request.frame) {
      if (state.stored?.contentKey !== request.contentKey) state.stored = { contentKey: request.contentKey, frames: [] }
    } else if (state.stored?.contentKey === request.contentKey) {
      state.stored.frames.push({ position: request.frame.position, path: `frame-${request.frame.position}.webp` })
    }
  }),
}))
vi.mock('@/features/documents', () => ({ invalidateDocumentHoverRead: vi.fn() }))
vi.mock('@/features/documents/documentCovers', () => ({ notifyDocumentCoverChanged: vi.fn() }))
vi.mock('./videoEditService', () => ({
  listVideoEditInstances: () => state.instances,
  subscribeVideoEdit: (fn: () => void) => { state.domain = fn; return () => {} },
  subscribeVideoEditView: (fn: () => void) => { state.view = fn; return () => {} },
  videoEditGestureActive: () => state.gesture,
}))

type Capture = (document: VideoEditComposition, frame: number, allowRender: boolean, signal: AbortSignal) => Promise<Uint8Array | undefined>

function document(): VideoEditDocument {
  const value = createVideoEditTestDocument('合成预览')
  value.sequences[0].clips = [{ id: 'title', itemId: 'title', name: '文字', kind: 'text', track: 0, start: 0, duration: 480, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '合成文字' }]
  return value
}
beforeEach(() => { state.stored = null; state.writes = []; state.instances = []; state.gesture = false })
afterEach(() => { vi.useRealTimers() })

it('逐档累积，前档位置不重画；重开后复用磁盘中已有帧，短片不重复渲染同一整数帧', async () => {
  const value = document()
  const captureHoverFrame = vi.fn<Parameters<Capture>, ReturnType<Capture>>().mockResolvedValue(new Uint8Array([1]))
  const builder = new VideoEditHoverFrameBuilder({ captureHoverFrame })
  let now = 10_000
  for (const count of [1, 4, 8, 16, 32, 48]) {
    while ((state.stored?.frames.length ?? 0) < count) { await builder.step(value, now, now); now += 10_000 }
    const captured = captureHoverFrame.mock.calls.length
    await builder.step(value, now - 9999, now - 9999)
    expect(captureHoverFrame).toHaveBeenCalledTimes(captured)
    expect(new Set(state.stored!.frames.map(frame => frame.position)).size).toBe(count)
  }
  expect(captureHoverFrame).toHaveBeenCalledTimes(48)
  expect(captureHoverFrame.mock.calls.map(call => call[1]).sort((a, b) => a - b)).toEqual(videoEditHoverPositions(480).map(item => item.frame).sort((a, b) => a - b))
  const reopened = new VideoEditHoverFrameBuilder({ captureHoverFrame })
  await reopened.step(value, now, now)
  expect(captureHoverFrame).toHaveBeenCalledTimes(48)
  expect(videoEditHoverPositions(2)).toHaveLength(2)
  expect(videoEditHoverPositions(1)).toHaveLength(1)
})

it('内容改变清空旧帧；交互中途取消的迟到取帧不能写入新内容', async () => {
  const value = document()
  let finish!: (bytes: Uint8Array) => void
  const captureHoverFrame = vi.fn<Parameters<Capture>, ReturnType<Capture>>().mockImplementation(() => new Promise<Uint8Array>(resolve => { finish = resolve }))
  const builder = new VideoEditHoverFrameBuilder({ captureHoverFrame })
  const pending = builder.step(value, 10_000, 10_000)
  await vi.waitFor(() => expect(captureHoverFrame).toHaveBeenCalledOnce())
  builder.invalidate()
  finish(new Uint8Array([1])); await pending
  expect(state.writes.filter(write => write.frame)).toHaveLength(0)
  const changed = { ...value, revision: 1, sequences: [{ ...value.sequences[0], clips: [{ ...value.sequences[0].clips[0], text: '新画面' }] }] }
  captureHoverFrame.mockImplementation(async () => new Uint8Array([2]))
  await builder.step(changed, 20_000, 20_000)
  expect(state.stored?.contentKey).toBe(await videoEditHoverContentKey(changed))
  expect(state.stored?.contentKey).not.toBe(await videoEditHoverContentKey(value))
  expect(state.stored?.frames).toHaveLength(1)
})

it('普通空闲只复用帧，完全空闲才允许补渲染，空闲之外不取帧', async () => {
  const value = document(), captureHoverFrame = vi.fn<Parameters<Capture>, ReturnType<Capture>>().mockResolvedValue(undefined)
  const builder = new VideoEditHoverFrameBuilder({ captureHoverFrame })
  await builder.step(value, 2999, 3000)
  expect(captureHoverFrame).not.toHaveBeenCalled()
  await builder.step(value, 3000, 4000)
  expect(captureHoverFrame.mock.lastCall?.[2]).toBe(false)
  await builder.step(value, 10_000, 11_000)
  expect(captureHoverFrame.mock.lastCall?.[2]).toBe(true)
})

it('有效序列帧优先；失效后用稳定素材抽样；两者都没有时不擦洗', async () => {
  const value = document()
  value.media = [{ id: 'image', name: '素材', kind: 'image', path: '/media/image.png', durationSeconds: 0, width: 320, height: 180 }]
  state.stored = { contentKey: await videoEditHoverContentKey(value), frames: [{ position: 0, path: '/covers/a.webp' }, { position: 1, path: '/covers/b.webp' }] }
  const composed = await loadVideoEditHoverPreview(value)
  expect(composed?.(0.9)?.source).toBe('/covers/b.webp')
  state.stored.contentKey = 'stale'
  const fallback = await loadVideoEditHoverPreview(value)
  expect(fallback?.(0.9)).toEqual({ source: '/media/image.png', sourceKind: 'image' })
  expect(fallback?.(0.9)).toEqual(fallback?.(0.9))
  expect(await loadVideoEditHoverPreview({ ...value, media: [] })).toBeNull()
})

it('播放、拖动、导出、编辑手势或宿主未就绪时都不生成，恢复空闲后才积累', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  const value = document(); await videoEditHoverContentKey(value)
  const owner = { document: value, contentVersion: 0, playing: false, busy: false, scrubbing: false } as VideoEditInstance
  state.instances = [owner]
  let ready = false
  const captureHoverFrame = vi.fn<Parameters<Capture>, ReturnType<Capture>>().mockResolvedValue(new Uint8Array([1]))
  const handlers = new Map<string, (event: { buttons?: number }) => void>()
  const targetWindow = { document: { hidden: false }, setInterval, clearInterval, addEventListener: (name: string, fn: (event: { buttons?: number }) => void) => handlers.set(name, fn), removeEventListener: (name: string) => handlers.delete(name) } as unknown as Window
  const stop = startVideoEditHoverFrames(owner, { captureHoverFrame }, () => ready, targetWindow)
  await vi.advanceTimersByTimeAsync(15_000)
  ready = true
  for (const flag of ['playing', 'scrubbing', 'busy'] as const) {
    owner[flag] = true; state.view(); await vi.advanceTimersByTimeAsync(15_000); owner[flag] = false
  }
  state.gesture = true; await vi.advanceTimersByTimeAsync(15_000); state.gesture = false
  handlers.get('pointerdown')?.({ buttons: 1 }); await vi.advanceTimersByTimeAsync(15_000)
  expect(captureHoverFrame).not.toHaveBeenCalled()
  handlers.get('pointerup')?.({ buttons: 0 })
  await vi.advanceTimersByTimeAsync(5000)
  // WebCrypto 是异步边界，用真实时钟等这一张结束。
  await vi.waitFor(() => expect(captureHoverFrame).toHaveBeenCalled())
  stop()
  expect(handlers.size).toBe(0)
})
