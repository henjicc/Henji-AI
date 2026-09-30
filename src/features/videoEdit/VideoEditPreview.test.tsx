// @vitest-environment jsdom
import { act, render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditClip, closeVideoEditProject, createVideoEditProject, editVideoProject, listVideoEditInstances, setVideoEditView } from './application/videoEditService'
import { VideoEditPreview } from './VideoEditPreview'
const pixel = vi.hoisted(() => ({ requests: [] as Array<{ frame: number; resolve: (value: { bitmap: ImageBitmap; sourceTimestamps: number[] }) => void }>, sessions: 0, update: vi.fn(), dispose: vi.fn() }))
vi.mock('./engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor() { pixel.sessions++ }
  updateDocument = pixel.update
  dispose = pixel.dispose
  renderBitmap(frame: number) { return new Promise(resolve => pixel.requests.push({ frame, resolve })) }
} }))
const bitmap = (): ImageBitmap => ({ width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap)
beforeEach(() => {
  vi.useFakeTimers(); installHarnessNativeStorage(); pixel.requests = []; pixel.sessions = 0; pixel.update.mockResolvedValue(undefined); pixel.dispose.mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/preview.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.useRealTimers(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('连续定位呈现已完成帧并只读取最新目标，卸载后迟到位图释放且不呈现', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  const canvas = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  act(() => { setVideoEditView(instance.document.id, { frame: 7, scrubbing: true }); setVideoEditView(instance.document.id, { frame: 15 }) })
  const first = bitmap(); await act(async () => { pixel.requests[0].resolve({ bitmap: first, sourceTimestamps: [0] }) })
  expect(canvas.dataset.presentedFrame).toBe('0'); expect(first.close).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(5) }); expect(pixel.requests.map(request => request.frame)).toEqual([0, 15])
  view.unmount(); const late = bitmap(); await act(async () => { pixel.requests[1].resolve({ bitmap: late, sourceTimestamps: [.5] }) })
  expect(late.close).toHaveBeenCalledOnce(); expect(canvas.dataset.presentedFrame).toBe('0'); expect(pixel.dispose).toHaveBeenCalledOnce()
})
it('参数修改更新同一渲染会话，旧文档结果不覆盖新内容且能够继续取帧', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  const canvas = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  act(() => { editVideoProject(instance.document.id, document => ({ ...document, clips: document.clips.map(clip => ({ ...clip, brightness: .5 })) })) })
  const stale = bitmap(); await act(async () => { pixel.requests[0].resolve({ bitmap: stale, sourceTimestamps: [0] }) })
  expect(canvas.dataset.presentedFrame).toBeUndefined(); expect(stale.close).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(pixel.sessions).toBe(1); expect(pixel.update).toHaveBeenCalledWith(instance.document)
  await act(async () => { pixel.requests[1].resolve({ bitmap: bitmap(), sourceTimestamps: [0] }) })
  expect(canvas.dataset.presentedFrame).toBe('0')
})
