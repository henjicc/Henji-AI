// @vitest-environment jsdom
import { act, render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditClip, appendVideoEditSequence, switchVideoEditSequence, closeVideoEditProject, createVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView } from './application/videoEditService'
import { VideoEditPreview } from './VideoEditPreview'
const pixel = vi.hoisted(() => ({ requests: [] as Array<{ frame: number; submitted?: () => void; resolve: (value: { sourceTimestamps: number[] }) => void }>, sessions: 0, update: vi.fn(), dispose: vi.fn() }))
vi.mock('./engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor() { pixel.sessions++ }
  updateDocument = pixel.update
  invalidateDocument = vi.fn()
  dispose = pixel.dispose
  present(frame: number, _sequential?: boolean, _scrubbing?: boolean, _deadline?: number, submitted?: () => void) { return new Promise(resolve => pixel.requests.push({ frame, resolve, submitted })) }
} }))
beforeEach(() => {
  vi.useFakeTimers(); installHarnessNativeStorage(); pixel.requests = []; pixel.sessions = 0; pixel.update.mockResolvedValue(undefined); pixel.dispose.mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/preview.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.stubGlobal('OffscreenCanvas', class {})
  HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn(() => ({} as OffscreenCanvas))
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('连续定位呈现已完成帧并只读取最新目标，卸载后迟到响应不呈现', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() })
  const canvas = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  act(() => { setVideoEditView(instance.document.id, { frame: 7, scrubbing: true }); setVideoEditView(instance.document.id, { frame: 15 }) })
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0] }) })
  expect(canvas.dataset.presentedFrame).toBe('0')
  await act(async () => { await vi.advanceTimersByTimeAsync(2) }); expect(pixel.requests.map(request => request.frame)).toEqual([0, 15])
  view.unmount(); await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [.5] }) })
  expect(canvas.dataset.presentedFrame).toBe('0'); expect(pixel.dispose).toHaveBeenCalledOnce()
})
it('参数修改更新同一渲染会话，旧文档结果不覆盖新内容且能够继续取帧', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() })
  const canvas = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  act(() => { editVideoSequence(instance.document.id, instance.activeSequenceId, document => ({ ...document, clips: document.clips.map(clip => ({ ...clip, brightness: .5 })) })) })
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0] }) })
  expect(canvas.dataset.presentedFrame).toBeUndefined()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(pixel.sessions).toBe(1); expect(pixel.update).toHaveBeenCalledWith(getActiveVideoEditSequence(instance))
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [0] }) })
  expect(canvas.dataset.presentedFrame).toBe('0')
})

it('拖动在 GPU 合成期间准备最新帧，完成回执才公布画面，松手后精确定位', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() })
  const canvas = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0] }); setVideoEditView(instance.document.id, { frame: 4, scrubbing: true }); await vi.advanceTimersByTimeAsync(2) })
  act(() => { pixel.requests[1].submitted?.(); setVideoEditView(instance.document.id, { frame: 11 }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(pixel.requests.map(request => request.frame)).toEqual([0, 4, 11])
  expect(canvas.dataset.presentedFrame).toBe('0')
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [4 / 30] }) })
  expect(canvas.dataset.presentedFrame).toBe('4')
  act(() => { pixel.requests[2].submitted?.(); setVideoEditView(instance.document.id, { scrubbing: false }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(1); pixel.requests[2].resolve({ sourceTimestamps: [11 / 30] }) })
  expect(pixel.requests[3].frame).toBe(11)
  await act(async () => { pixel.requests[3].resolve({ sourceTimestamps: [11 / 30] }) })
  expect(canvas.dataset.presentedFrame).toBe('11'); expect(canvas.dataset.scrubbing).toBe('false')
})
it('快速切序列等待旧GPU所有者释放，只初始化最新序列', async () => {
  const instance = (await createVideoEditProject())!; const first = instance.activeSequenceId
  const second = appendVideoEditSequence(instance.document.id)
  const onError = vi.fn(); const view = render(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { await Promise.resolve() })
  expect(pixel.sessions).toBe(1)
  let finish!: () => void
  pixel.dispose.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  act(() => { switchVideoEditSequence(instance.document.id, second) }); view.rerender(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { await Promise.resolve() }); expect(pixel.sessions).toBe(1)
  act(() => { switchVideoEditSequence(instance.document.id, first) }); view.rerender(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { finish() }); expect(pixel.sessions).toBe(2)
  expect(pixel.dispose).toHaveBeenCalledTimes(1)
  expect(onError).not.toHaveBeenCalled()
})
