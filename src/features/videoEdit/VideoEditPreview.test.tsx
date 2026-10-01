// @vitest-environment jsdom
import { act, render, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditClip, appendVideoEditMedia, appendVideoEditSequence, switchVideoEditSequence, closeVideoEditProject, createVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView } from './application/videoEditService'
import { VideoEditPreview } from './VideoEditPreview'
const pixel = vi.hoisted(() => ({ requests: [] as Array<{ frame: number; sequential?: boolean; submitted?: () => void; resolve: (value: { sourceTimestamps: number[] }) => void }>, sessions: 0, update: vi.fn(), dispose: vi.fn(), mixAudio: vi.fn() }))
vi.mock('./engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor() { pixel.sessions++ }
  updateDocument = pixel.update
  invalidateDocument = vi.fn()
  dispose = pixel.dispose
  mixAudio = pixel.mixAudio
  present(frame: number, sequential?: boolean, _scrubbing?: boolean, _deadline?: number, submitted?: () => void) { return new Promise(resolve => pixel.requests.push({ frame, sequential, resolve, submitted })) }
} }))
beforeEach(() => {
  vi.useFakeTimers(); installHarnessNativeStorage(); pixel.requests = []; pixel.sessions = 0; pixel.update.mockResolvedValue(undefined); pixel.dispose.mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/preview.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.stubGlobal('OffscreenCanvas', class {})
  HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn(() => ({} as OffscreenCanvas))
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('画面标注捕获原选区和时间，后续定位及指针取消不标注新目标', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const onError = vi.fn(); const view = render(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { await Promise.resolve() })
  const canvas = view.getByLabelText('剪辑画面'); const host = canvas.parentElement!
  Object.defineProperty(host, 'setPointerCapture', { value: vi.fn() })
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 180, right: 320, width: 320, height: 180, toJSON: () => ({}) })
  fireEvent.click(view.getByRole('button', { name: '点标注' }))
  const down = () => fireEvent(canvas, new MouseEvent('pointerdown', { clientX: 32, clientY: 36, bubbles: true }))
  const up = () => fireEvent(canvas, new MouseEvent('pointerup', { clientX: 64, clientY: 72, bubbles: true }))
  down(); act(() => { setVideoEditView(instance.document.id, { frame: 5 }); setVideoEditView(instance.document.id, { frame: 0 }) }); up()
  expect(getActiveVideoEditSequence(instance).annotations).toHaveLength(0)
  down(); fireEvent.pointerCancel(host); up(); expect(getActiveVideoEditSequence(instance).annotations).toHaveLength(0)
  down(); up(); expect(getActiveVideoEditSequence(instance).annotations).toMatchObject([{ clipId: instance.selection, frame: 0, x: .1, y: .2 }])
  expect(onError).not.toHaveBeenCalled(); view.unmount()
})
it('同向播放中定位重建时钟，旧取帧回执不能覆盖新目标', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  setVideoEditView(instance.document.id, { frame: 5, playing: true })
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve(); pixel.requests[0].resolve({ sourceTimestamps: [5 / 30] }) })
  expect(pixel.requests[1].frame).toBe(6)
  act(() => setVideoEditView(instance.document.id, { frame: 60 }))
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [6 / 30] }); await vi.advanceTimersByTimeAsync(1) })
  expect(instance.frame).toBe(60); expect(pixel.requests[2].frame).toBe(60)
  await act(async () => { pixel.requests[2].resolve({ sourceTimestamps: [2] }) })
  expect(pixel.requests[3].frame).toBe(61)
  view.unmount()
})
it('播放首次画面等待期间的新命令不会启动旧时钟', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  setVideoEditView(instance.document.id, { frame: 5, playing: true })
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() })
  act(() => setVideoEditView(instance.document.id, { frame: 40, playbackDirection: -1 }))
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [5 / 30] }); await vi.advanceTimersByTimeAsync(1) })
  expect(instance.frame).toBe(40); expect(pixel.requests[1].frame).toBe(40)
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [40 / 30] }) })
  expect(pixel.requests[2].frame).toBe(39)
  view.unmount()
})
it('等待音频启动期间切反向，不排旧方向声音或画面', async () => {
  const instance = (await createVideoEditProject())!
  appendVideoEditMedia(instance.document.id, { id: 'audio-video', name: '原视频', kind: 'video', path: 'D:/original.mp4', width: 320, height: 180, durationSeconds: 3, hasAudio: true })
  appendVideoEditClip(instance.document.id, 'audio-video')
  let resume!: () => void
  const close = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('AudioContext', class { private clock = 1; get currentTime() { this.clock += .001; return this.clock } resume = () => new Promise<void>(resolve => { resume = resolve }); close = close })
  pixel.mixAudio.mockClear()
  setVideoEditView(instance.document.id, { frame: 5, playing: true })
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve(); pixel.requests[0].resolve({ sourceTimestamps: [5 / 30] }) })
  act(() => setVideoEditView(instance.document.id, { playbackDirection: -1 }))
  await act(async () => { resume(); await vi.advanceTimersByTimeAsync(1) })
  expect(pixel.mixAudio).not.toHaveBeenCalled(); expect(pixel.requests.map(request => request.frame)).toEqual([5, 5])
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [5 / 30] }) })
  expect(pixel.requests[2].frame).toBe(4)
  view.unmount(); expect(close).toHaveBeenCalledOnce()
})
it('节目反向按实际完成帧倒序推进，停止后迟到帧不改变播放位置', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  setVideoEditView(instance.document.id, { frame: 5, playing: true, playbackDirection: -1 })
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() }); expect(pixel.requests[0].frame).toBe(5)
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [5 / 30] }) }); expect(pixel.requests[1].frame).toBe(4)
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [4 / 30] }); await vi.advanceTimersByTimeAsync(1) })
  expect(instance.frame).toBe(4); expect(pixel.requests[2].frame).toBe(3)
  expect(pixel.requests.slice(0, 3).map(request => request.sequential)).toEqual([false, false, false])
  act(() => setVideoEditView(instance.document.id, { playing: false }))
  await act(async () => { pixel.requests[2].resolve({ sourceTimestamps: [3 / 30] }); await vi.advanceTimersByTimeAsync(2) })
  expect(instance.frame).toBe(4); expect(pixel.requests[3].frame).toBe(4)
  view.unmount(); await act(async () => { pixel.requests[3].resolve({ sourceTimestamps: [4 / 30] }) }); expect(pixel.dispose).toHaveBeenCalledOnce()
})
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
