import { createVideoEditTestProject as createVideoEditProject } from './application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import { act, render, cleanup, fireEvent } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditClip, appendVideoEditMedia, appendVideoEditSequence, deleteVideoEditSequence, switchVideoEditSequence, closeVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, setVideoEditTimelineView, undoVideoEdit, beginVideoEditGesture, finishVideoEditGesture, updateVideoEditCreativeIntents } from './application/videoEditService'
import { setVideoEditAnnotationBrush } from './application/videoEditAnnotations'
import { applyVideoEditBuiltinEffect, updateVideoEditBuiltinEffect } from './application/videoEditCompositing'
import { VideoEditPreview } from './VideoEditPreview'
import { VideoEditGpuDeviceLostError } from './engine/videoEditGpuFailure'
import { registerVideoEditSourcePresenter, updateVideoEditSource } from './application/videoEditSource'
import { resetVideoEditPlaybackResolutionCache, setVideoEditPlaybackResolution } from './application/videoEditPlaybackResolution'
import { setVideoEditPosterFrame } from './application/videoEditProgramCapture'
import { startVideoMotion, setVideoMotionOptions, setVideoMotionPointer, videoMotionState, videoMotionComposition } from './application/videoEditMotionDraft'
const stopNotification = vi.hoisted(() => vi.fn())
const pixel = vi.hoisted(() => ({ preopen: vi.fn(), arm: vi.fn(async () => undefined), requests: [] as Array<{ frame: number; sequential?: boolean; deadline?: number; submitted?: () => void; resolve: (value: { sourceTimestamps: number[]; presented?: boolean; history?: ImageBitmap }) => void; reject: (error: Error) => void }>, sessions: 0, update: vi.fn(), invalidate: vi.fn(), dispose: vi.fn(), mixAudio: vi.fn(), scale: vi.fn() }))
vi.mock('./application/videoEditProjectCover', () => ({ saveVideoEditPosterCover: vi.fn(async () => undefined), updateVideoEditProjectCover: vi.fn(async () => undefined) }))
vi.mock('./engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async prepareGpu() {}
  adoptProject() {}
  preopenSequence = pixel.preopen
  constructor() { pixel.sessions++ }
  updateDocument = pixel.update
  invalidateDocument = pixel.invalidate
  dispose = pixel.dispose
  mixAudio = pixel.mixAudio
  setRenderDivisor = pixel.scale
  armPlayback = pixel.arm
  stopPlayback = stopNotification
  setSmartRegions = vi.fn()
  present(frame: number, sequential?: boolean, _scrubbing?: boolean, deadline?: number, submitted?: () => void) { return new Promise((resolve, reject) => pixel.requests.push({ frame, sequential, deadline, resolve, reject, submitted })) }
} }))
beforeEach(() => {
  stopNotification.mockClear()
  vi.useFakeTimers(); installHarnessNativeStorage(); pixel.requests = []; pixel.sessions = 0; pixel.preopen.mockClear(); pixel.arm.mockClear(); pixel.invalidate.mockClear(); pixel.update.mockResolvedValue(undefined); pixel.dispose.mockResolvedValue(undefined); pixel.scale.mockReset(); pixel.scale.mockResolvedValue(undefined); localStorage.clear(); resetVideoEditPlaybackResolutionCache()
  vi.spyOn(getPlatform().system, 'memoryInfo').mockResolvedValue({ availableBytes: 4 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/preview.hjvid')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.stubGlobal('OffscreenCanvas', class {})
  HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn(() => ({} as OffscreenCanvas))
})
afterEach(async () => { cleanup(); await vi.advanceTimersByTimeAsync(5001); vi.useRealTimers(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('暂停时即使画面未变化或上一帧仍在解码，也立即通知 Worker 取消前瞻', async () => {
  const owner = await createVideoEditProject(); appendVideoEditClip(owner.document.id)
  const view = render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  act(() => setVideoEditView(owner.document.id, { playing: true }))
  act(() => setVideoEditView(owner.document.id, { playing: false }))
  expect(stopNotification).toHaveBeenCalledWith(owner.frame)
  view.unmount()
})
it('讲解回执像素用于真实节目呈现；后续普通帧不能显示旧图，关闭释放位图', async () => {
  const draw = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) { return this.getAttribute('aria-hidden') === 'true' ? { drawImage: draw } as unknown as CanvasRenderingContext2D : null })
  const owner = await createVideoEditProject(); appendVideoEditClip(owner.document.id)
  const view = render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  const history = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0], presented: true, history }) })
  const surface = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  expect(draw).toHaveBeenCalledWith(history, 0, 0)
  expect(surface.parentElement?.querySelector('canvas[aria-hidden="true"]')?.getAttribute('data-presented-frame')).toBe('0')
  act(() => setVideoEditView(owner.document.id, { frame: 5 }))
  await act(async () => { await vi.advanceTimersByTimeAsync(30) })
  await act(async () => { pixel.requests.at(-1)!.resolve({ sourceTimestamps: [5 / 30], presented: true }) })
  expect(surface.parentElement?.querySelector('canvas[aria-hidden="true"]')).toBeNull()
  expect(history.close).toHaveBeenCalledOnce()
  view.unmount()
})
it('讲解元数据更新不撤销正在呈现的同一画面', async () => {
  const owner = (await createVideoEditProject())!; appendVideoEditClip(owner.document.id)
  const view = render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  pixel.invalidate.mockClear()
  act(() => updateVideoEditCreativeIntents(owner.document.id, { resources: [], sessions: [], drafts: [] }))
  expect(pixel.invalidate).not.toHaveBeenCalled()
  expect(pixel.sessions).toBe(1)
  view.unmount()
})
it('半速示范重画当前时刻且取消旧姿态，覆盖已有曲线不会重启播放时钟', async () => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const testStart = Date.now(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - testStart)
  const owner = await createVideoEditProject(); appendVideoEditClip(owner.document.id)
  const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips[0]
  editVideoSequence(owner.document.id, sequence.id, doc => ({ ...doc, clips: doc.clips.map(c => ({ ...c, curves: { x: [{ time: 0, value: 0, interpolation: 'linear' }] } })) }))
  setVideoEditView(owner.document.id, { selection: clip.id, frame: 20 })
  await startVideoMotion(owner.document.id, 'record'); setVideoMotionOptions(owner.document.id, { speed: .5 })
  setVideoEditView(owner.document.id, { playing: true })
  const view = render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [20 / 30], presented: true }) })
  const canvas = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  const clock = canvas.dataset.playClockStartAt
  expect(clock).toBeDefined()
  act(() => { setVideoMotionPointer(owner.document.id, true); videoMotionState(owner)!.pose.position = [.7, .5]; setVideoMotionOptions(owner.document.id, { mode: 'navigate' }) })
  expect(pixel.invalidate).toHaveBeenLastCalledWith(videoMotionComposition(owner)!.revision)
  await act(async () => { await vi.advanceTimersByTimeAsync(2) })
  expect(pixel.requests[1]).toMatchObject({ frame: 20, deadline: undefined, sequential: false })
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [20 / 30], presented: true }); await vi.advanceTimersByTimeAsync(200) })
  expect(canvas.dataset.playClockStartAt).toBe(clock)
  expect(pixel.requests[2].frame).toBe(21)
  expect(pixel.sessions).toBe(1)
  act(() => { setVideoMotionPointer(owner.document.id, false); setVideoEditView(owner.document.id, { playing: false }) })
})
it('节目画面跟着命令带的工具走：文字工具接管批注工具，回到选择工具后两者都退出，节目底栏不再有模式下拉', async () => {
  const instance = await createVideoEditProject(); const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() })
  act(() => setVideoEditTimelineView(instance.document.id, { tool: 'annotate' }))
  expect(view.getByLabelText('画面标注层').className).toContain('cursor-crosshair')
  act(() => setVideoEditTimelineView(instance.document.id, { tool: 'type' }))
  expect(view.getByLabelText('节目文字工具')).toBeTruthy(); expect(view.queryByLabelText('这里要改什么？')).toBeNull()
  act(() => setVideoEditTimelineView(instance.document.id, { tool: 'select' }))
  expect(view.getByLabelText('节目文字工具').className).toContain('pointer-events-none'); expect(view.getByLabelText('画面标注层').className).not.toContain('cursor-crosshair')
  expect(view.queryByRole('group', { name: '节目画面模式' })).toBeNull(); expect(view.queryByRole('button', { name: '移动画面' })).toBeNull()
  view.unmount()
})
it('画面标注捕获原选区和时间，后续定位及指针取消不标注新目标', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const onError = vi.fn(); const view = render(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { await Promise.resolve() })
  const host = view.getByLabelText('画面标注层'); const canvas = host
  Object.defineProperty(host, 'setPointerCapture', { value: vi.fn() })
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 180, right: 320, width: 320, height: 180, toJSON: () => ({}) })
  act(() => { setVideoEditAnnotationBrush(instance.document.id, { shape: 'point' }); setVideoEditTimelineView(instance.document.id, { tool: 'annotate' }) })
  const down = () => fireEvent(canvas, new MouseEvent('pointerdown', { clientX: 32, clientY: 36, bubbles: true }))
  const up = () => fireEvent(canvas, new MouseEvent('pointerup', { clientX: 64, clientY: 72, bubbles: true }))
  down(); act(() => { setVideoEditView(instance.document.id, { frame: 5 }); setVideoEditView(instance.document.id, { frame: 0 }) }); up()
  expect(getActiveVideoEditSequence(instance).annotations).toHaveLength(0)
  down(); fireEvent.pointerCancel(host); up(); expect(getActiveVideoEditSequence(instance).annotations).toHaveLength(0)
  down(); up(); expect(getActiveVideoEditSequence(instance).annotations).toHaveLength(0)
  fireEvent.change(view.getByLabelText('这里要改什么？'), { target: { value: '改这里' } }); fireEvent.click(view.getByRole('button', { name: '加入待发送（回车）' }))
  expect(getActiveVideoEditSequence(instance).annotations).toMatchObject([{ clipId: instance.selection, frame: 0, status: 'draft', target: { x: .1, y: .2 } }])
  expect(onError).not.toHaveBeenCalled(); view.unmount()
})
it('同向播放中定位重建时钟，旧取帧回执不能覆盖新目标', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  setVideoEditView(instance.document.id, { frame: 5, playing: true })
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [5 / 30] }) })
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
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [5 / 30] }) })
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
  act(() => { editVideoSequence(instance.document.id, instance.activeSequenceId, document => ({ ...document, clips: document.clips.map(clip => ({ ...clip, opacity: .5 })) })) })
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0], presented: false }) })
  expect(canvas.dataset.presentedFrame).toBeUndefined()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  // Paused previews ask for originals (proxies only during playback/scrubbing); the session still takes the parameter path.
  expect(pixel.sessions).toBe(1); expect(pixel.update).toHaveBeenCalledWith(getActiveVideoEditSequence(instance), true)
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [0] }) })
  expect(canvas.dataset.presentedFrame).toBe('0')
})

it.each([false, true])('同序列参数更新期间已提交画面记录真实回执，不推进新文档播放位置（播放=%s）', async playing => {
  const owner = (await createVideoEditProject())!; appendVideoEditClip(owner.document.id)
  setVideoEditView(owner.document.id, { playing })
  const view = render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  const canvas = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  const presentedRevision = owner.document.revision
  act(() => {
    editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, x: .2 })) }))
    setVideoEditView(owner.document.id, { frame: 5 })
  })
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0], presented: true }) })
  expect(canvas.dataset).toMatchObject({ presentedFrame: '0', presentedRevision: String(presentedRevision) })
  expect(owner.frame).toBe(5)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(pixel.sessions).toBe(1); expect(pixel.requests[1].frame).toBe(5)
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [5 / 30], presented: true }) })
  expect(canvas.dataset).toMatchObject({ presentedFrame: '5', presentedRevision: String(owner.document.revision) })
})

it('parameter moves coalesce to the latest snapshot once per display period and retain one undo step', async () => {
  const testStart = Date.now(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - testStart)
  const owner = (await createVideoEditProject())!; appendVideoEditClip(owner.document.id)
  const document = getActiveVideoEditSequence(owner); const clipId = document.clips[0].id
  const [effectId] = applyVideoEditBuiltinEffect(owner.document.id, document.id, [clipId], 'color_grade')
  const target = { projectId: owner.document.id, sequenceId: document.id, clipId }
  const history = owner.past.length
  render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ presented: true, sourceTimestamps: [0] }) })
  const gesture = beginVideoEditGesture(owner.document.id)
  act(() => updateVideoEditBuiltinEffect(target, effectId, { params: { exposure: .1 } }, gesture))
  await act(async () => { await vi.advanceTimersByTimeAsync(2) })
  expect(pixel.update).toHaveBeenCalledTimes(1)
  await act(async () => { pixel.requests[1].resolve({ presented: true, sourceTimestamps: [0] }) })
  act(() => { for (let i = 1; i <= 60; i++) updateVideoEditBuiltinEffect(target, effectId, { params: { exposure: i / 60 } }, gesture) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5) })
  expect(pixel.update).toHaveBeenCalledTimes(1)
  act(() => finishVideoEditGesture(gesture))
  await act(async () => { await vi.advanceTimersByTimeAsync(15) })
  expect(pixel.update).toHaveBeenCalledTimes(2)
  expect(pixel.update.mock.calls[1][0].clips[0].effects[0].builtin.params.exposure).toBe(1)
  expect(owner.past).toHaveLength(history + 1)
})

it('较旧拖动画面的完成回执不倒写当前显示面或调度位置', async () => {
  const owner = (await createVideoEditProject())!; appendVideoEditClip(owner.document.id)
  const view = render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  const canvas = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0], presented: true }); setVideoEditView(owner.document.id, { frame: 4, scrubbing: true }); await vi.advanceTimersByTimeAsync(2) })
  act(() => { pixel.requests[1].submitted?.(); setVideoEditView(owner.document.id, { frame: 11 }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(1); pixel.requests[2].resolve({ sourceTimestamps: [11 / 30], presented: true }) })
  const requestedAt = canvas.dataset.requestedAt
  await act(async () => { pixel.requests[1].resolve({ sourceTimestamps: [4 / 30], presented: true }) })
  expect(canvas.dataset).toMatchObject({ presentedFrame: '11', sourceTimestamps: String(11 / 30), requestedAt })
  expect(owner.frame).toBe(11)
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
it('切换序列（含尺寸不同的序列）复用同一渲染会话只换文档，不销毁也不重建', async () => {
  const instance = (await createVideoEditProject())!; const first = instance.activeSequenceId
  const { width, height } = getActiveVideoEditSequence(instance)
  const same = appendVideoEditSequence(instance.document.id, { width, height })
  const other = appendVideoEditSequence(instance.document.id, { width: width / 2, height: height / 2 })
  const onError = vi.fn(); const view = render(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { await Promise.resolve() })
  expect(pixel.sessions).toBe(1)
  for (const target of [same, other, first]) {
    act(() => { switchVideoEditSequence(instance.document.id, target) }); expect(pixel.preopen).toHaveBeenLastCalledWith(expect.objectContaining({ id: target }), instance.frame); view.rerender(<VideoEditPreview instance={instance} onError={onError} />)
    await act(async () => { await Promise.resolve() })
  }
  expect(pixel.sessions).toBe(1); expect(pixel.dispose).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})

it('没有序列时预热渲染会话，第一个序列出现时节目面板直接接管，不新建也不释放', async () => {
  const instance = (await createVideoEditProject())!
  deleteVideoEditSequence(instance.document.id, instance.activeSequenceId)
  expect(instance.activeSequenceId).toBe('')
  const onError = vi.fn(); const view = render(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { await Promise.resolve() })
  expect(pixel.sessions).toBe(1)
  act(() => { switchVideoEditSequence(instance.document.id, appendVideoEditSequence(instance.document.id)) }); view.rerender(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(5) })
  expect(pixel.sessions).toBe(1); expect(pixel.dispose).not.toHaveBeenCalled()
  expect(view.getByLabelText('剪辑画面')).toBeTruthy()
  expect(onError).not.toHaveBeenCalled()
})

it('隐藏节目停止取帧并释放会话，显示后等待退休完成且迟到画面不发布', async () => {
  const owner = (await createVideoEditProject())!; const onError = vi.fn()
  const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => { await Promise.resolve() }); const oldCanvas = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  let retire!: () => void; pixel.dispose.mockImplementationOnce(() => new Promise<void>(resolve => { retire = resolve }))
  act(() => view.rerender(<VideoEditPreview instance={owner} onError={onError} visible={false} />))
  expect(pixel.dispose).toHaveBeenCalledOnce(); expect(view.queryByLabelText('剪辑画面')).toBeNull()
  act(() => view.rerender(<VideoEditPreview instance={owner} onError={onError} />))
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0] }) }); expect(oldCanvas.dataset.presentedFrame).toBeUndefined(); expect(pixel.sessions).toBe(1)
  await act(async () => { retire() }); expect(pixel.sessions).toBe(2); expect(onError).not.toHaveBeenCalled()
})

it('选择工具下直接拖画面：连续更新只写一次历史，改选区和Escape取消原手势，其他工具不拖动', async () => {
  // 选择工具下单击画面会先选中指针下的画面片段（代码元素层），再拖动它；用铺满画面的图片片段。
  const owner = (await createVideoEditProject())!
  appendVideoEditMedia(owner.document.id, { id: 'still', name: '图片', path: 'D:/still.png', kind: 'image', width: 320, height: 180, durationSeconds: 3 }); appendVideoEditClip(owner.document.id, 'still')
  const clipId = owner.selection!; const onError = vi.fn()
  const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => { await Promise.resolve() }); const host = view.getByLabelText('剪辑画面').parentElement!
  Object.defineProperty(host, 'setPointerCapture', { value: vi.fn() })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 180))
  const send = (type: string, x: number, y: number) => fireEvent(host, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }))
  const history = owner.past.length
  send('pointerdown', 32, 18); send('pointermove', 64, 36); send('pointermove', 96, 54)
  expect(getActiveVideoEditSequence(owner).clips[0]).toMatchObject({ x: .2, y: .2 }); expect(owner.past).toHaveLength(history)
  send('pointerup', 96, 54); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0)
  send('pointerdown', 0, 0); send('pointermove', 32, 18); fireEvent.keyDown(window, { key: 'Escape' }); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0)
  send('pointerdown', 0, 0); send('pointermove', 32, 18); act(() => setVideoEditTimelineView(owner.document.id, { selectedClipIds: [] })); send('pointerup', 32, 18)
  expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0); expect(owner.selection).not.toBe(clipId)
  act(() => setVideoEditTimelineView(owner.document.id, { tool: 'razor', selectedClipIds: [clipId] }))
  send('pointerdown', 32, 18); send('pointermove', 96, 54); send('pointerup', 96, 54)
  expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0); expect(onError).not.toHaveBeenCalled()
})

function installAudioGraph(resume: () => Promise<void> = async () => {}) {
  const nodes: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = []
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  const createGain = vi.fn(() => ({ ...node(), gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelAndHoldAtTime: vi.fn() } }))
  const createSource = vi.fn(() => { const source = { ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: undefined }; nodes.push(source); return source })
  const close = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('AudioContext', class {
    sampleRate = 48000
    private clock = 1; get currentTime() { this.clock += .001; return this.clock }
    destination = node(); resume = resume; close = close; createGain = createGain; createBufferSource = createSource
    createChannelSplitter = node; createAnalyser = () => ({ ...node(), fftSize: 1024, smoothingTimeConstant: 0, getFloatTimeDomainData: (data: Float32Array) => data.fill(.25) })
  })
  return { createGain, createSource, close, nodes }
}
async function audioPreviewFixture() {
  const owner = (await createVideoEditProject())!
  appendVideoEditMedia(owner.document.id, { id: 'audio-actual', name: '音画', path: 'D:/audio.mp4', kind: 'video', width: 320, height: 180, durationSeconds: 3, hasAudio: true }); appendVideoEditClip(owner.document.id, 'audio-actual')
  setVideoEditView(owner.document.id, { frame: 0, playing: true }); return owner
}
it('单击节目定位不发声；拖动出声跟着节目实际呈现的画面，画面回来之前不先出声', async () => {
  const graph = installAudioGraph(); const owner = await audioPreviewFixture(); setVideoEditView(owner.document.id, { playing: false })
  pixel.mixAudio.mockImplementation(async (_from: number, duration: number) => ({ duration }))
  const onError = vi.fn(); render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => {})
  await act(async () => { setVideoEditView(owner.document.id, { frame: 5 }); await vi.advanceTimersByTimeAsync(5) })
  expect(graph.nodes).toHaveLength(0)
  await act(async () => { setVideoEditView(owner.document.id, { frame: 6, scrubbing: true }); await vi.advanceTimersByTimeAsync(5) })
  // 画面还没回来：不先出声，否则声音会跑到画面前面。
  expect(graph.nodes).toHaveLength(0)
  // 依次让节目的取帧回来，直到拖到的第 6 帧呈现。
  for (let index = 0; index < 4 && !pixel.requests.some(entry => entry.frame === 6); index++) {
    await act(async () => { pixel.requests.at(-1)!.resolve({ sourceTimestamps: [0], presented: true }); await vi.advanceTimersByTimeAsync(5) })
  }
  expect(graph.nodes).toHaveLength(0)
  const request = pixel.requests.find(entry => entry.frame === 6)!
  expect(request).toBeDefined()
  await act(async () => { request.resolve({ sourceTimestamps: [.2], presented: true }); await vi.advanceTimersByTimeAsync(5) })
  expect(graph.nodes).toHaveLength(1)
  expect(pixel.mixAudio).toHaveBeenLastCalledWith(.2, .08, true)
  expect(onError).not.toHaveBeenCalled()
})
it('音频启动等待后隐藏，晚到resume不新建退役节点', async () => {
  let resume!: () => void; const graph = installAudioGraph(() => new Promise<void>(resolve => { resume = resolve }))
  const owner = await audioPreviewFixture(); const onError = vi.fn(); const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0] }) }); expect(resume).toBeTypeOf('function')
  act(() => view.rerender(<VideoEditPreview instance={owner} onError={onError} visible={false} />))
  await act(async () => { resume() }); expect(graph.close).toHaveBeenCalledOnce(); expect(graph.createGain).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled()
})
it('节目首帧已呈现后等待声音启动，立即暂停仍保留真实画面回执', async () => {
  let resume!: () => void; installAudioGraph(() => new Promise<void>(resolve => { resume = resolve }))
  const owner = await audioPreviewFixture(); const onError = vi.fn(); const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0] }) })
  act(() => setVideoEditView(owner.document.id, { frame: 0, playing: false }))
  await act(async () => { resume(); await vi.advanceTimersByTimeAsync(1) })
  expect(pixel.requests).toHaveLength(1)
  const surface = view.getByLabelText('剪辑画面') as HTMLCanvasElement
  expect(surface.dataset).toMatchObject({ presentedFrame: '0', sourceTimestamps: '0', scrubbing: 'false' })
  expect(owner).toMatchObject({ frame: 0, playing: false }); expect(onError).not.toHaveBeenCalled(); view.unmount()
})
it('未呈现的播放首帧重新请求，不发布画面或启动旧时钟', async () => {
  const graph = installAudioGraph(); const owner = await audioPreviewFixture(); const onError = vi.fn()
  const view = render(<VideoEditPreview instance={owner} onError={onError} />); await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [], presented: false }); await vi.advanceTimersByTimeAsync(1) })
  expect(pixel.requests[1].frame).toBe(0); expect(graph.createGain).not.toHaveBeenCalled()
  expect((view.getByLabelText('剪辑画面') as HTMLCanvasElement).dataset.presentedFrame).toBeUndefined()
  expect(onError).not.toHaveBeenCalled(); view.unmount()
})
it('GPU等待时静音使晚到旧混音不再播放', async () => {
  const graph = installAudioGraph(); let mixed!: (buffer: { duration: number }) => void
  pixel.mixAudio.mockImplementationOnce(() => new Promise(resolve => { mixed = resolve }))
  const owner = await audioPreviewFixture(); const onError = vi.fn(); const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0] }) }); expect(mixed).toBeTypeOf('function')
  act(() => editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, muted: true })) })))
  await act(async () => { mixed({ duration: .5 }) }); expect(graph.createSource).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled(); view.unmount()
})
it('已有音频节点在GPU等待时静音立即停止，不等待下次取帧', async () => {
  const graph = installAudioGraph(); pixel.mixAudio.mockResolvedValueOnce({ duration: .5 })
  const owner = await audioPreviewFixture(); const onError = vi.fn(); const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0] }) })
  expect(graph.nodes).toHaveLength(1); expect(graph.nodes[0].start).toHaveBeenCalledOnce()
  expect(pixel.requests[1].frame).toBe(1)
  act(() => editVideoSequence(owner.document.id, owner.activeSequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, muted: true })) })))
  expect(graph.nodes[0].stop).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled(); view.unmount()
})
it('源前台播放在GPU等待时立即停止节目声音', async () => {
  const graph = installAudioGraph(); pixel.mixAudio.mockResolvedValueOnce({ duration: .5 })
  const owner = await audioPreviewFixture(); const onError = vi.fn(); const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0] }) })
  expect(graph.nodes[0].start).toHaveBeenCalledOnce()
  const off = registerVideoEditSourcePresenter(owner.document.id, async request => ({ ...request, presentedTimeUs: request.timeUs }))
  await act(async () => {
    const pending = updateVideoEditSource(owner.document.id, { itemId: owner.document.items[0].id, playing: true })
    expect(graph.nodes[0].stop).toHaveBeenCalledOnce(); expect(owner.playing).toBe(false)
    await pending
  })
  expect(onError).not.toHaveBeenCalled(); off(); view.unmount()
})
it('旧取帧失败不暂停后续节目命令', async () => {
  const owner = (await createVideoEditProject())!; appendVideoEditClip(owner.document.id)
  setVideoEditView(owner.document.id, { frame: 5, playing: true }); const onError = vi.fn()
  const view = render(<VideoEditPreview instance={owner} onError={onError} />); await act(async () => {})
  act(() => setVideoEditView(owner.document.id, { frame: 40, playing: true }))
  await act(async () => { pixel.requests[0].reject(new Error('旧解码失败')); await vi.advanceTimersByTimeAsync(1) })
  expect(owner).toMatchObject({ frame: 40, playing: true }); expect(pixel.requests[1].frame).toBe(40); expect(onError).not.toHaveBeenCalled(); view.unmount()
})
it('节目面板重挂载（停靠与浮窗间迁移）必须等旧渲染会话实际退场后才接入新显示面', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  let finishDispose!: () => void
  pixel.dispose.mockImplementationOnce(() => new Promise<void>(resolve => { finishDispose = resolve }))
  const first = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() }); expect(pixel.sessions).toBe(1)
  first.unmount()
  const moved = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(pixel.sessions).toBe(1); expect(moved.queryByLabelText('剪辑画面')).toBeNull()
  await act(async () => { finishDispose(); await Promise.resolve(); await Promise.resolve() })
  expect(pixel.sessions).toBe(2); expect(moved.getByLabelText('剪辑画面')).toBeTruthy()
  moved.unmount()
})
it('GPU 丢失释放旧会话后重建；连续失效停止自动重试，避免反复占用资源', async () => {
  const owner = await createVideoEditProject(); appendVideoEditClip(owner.document.id)
  const view = render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  for (let attempt = 0; attempt < 3; attempt++) {
    await act(async () => { pixel.requests.at(-1)!.reject(new VideoEditGpuDeviceLostError('device destroyed')); await vi.advanceTimersByTimeAsync(1) })
  }
  expect(pixel.sessions).toBe(3)
  expect(pixel.dispose).toHaveBeenCalledTimes(3)
  expect(view.getByText(/画面处理连续中断/)).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
  expect(pixel.sessions).toBe(3)
  view.unmount()
})
it('节目渲染失败在监视器上就地提示，不转交全局错误；序列改变后自动重试并清除提示', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const onError = vi.fn(); const view = render(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { pixel.requests.shift()!.reject(new Error('找不到素材「A」的源文件，请在素材面板中右键该素材，选择“重新定位源文件”。')) })
  expect(view.getByText('找不到素材「A」的源文件，请在素材面板中右键该素材，选择“重新定位源文件”。')).toBeTruthy()
  // An unchanged sequence at the same frame is not re-requested.
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) }); expect(pixel.requests).toHaveLength(0)
  act(() => { editVideoSequence(instance.document.id, instance.activeSequenceId, sequence => ({ ...sequence, name: '重新定位后' })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(pixel.requests).toHaveLength(1)
  await act(async () => { pixel.requests.shift()!.resolve({ sourceTimestamps: [0], presented: true }) })
  expect(view.queryByText(/找不到素材/)).toBeNull(); expect(onError).not.toHaveBeenCalled(); view.unmount()
})
it('渲染失败后即使序列与播放头都不变也会自行重试（间隔 2 秒起逐次加倍），解码恢复后清除提示（3.1）', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() })
  const failure = '素材「A」的解码暂时中断，请稍后重试；如果一直出现，请重启软件。'
  await act(async () => { pixel.requests.shift()!.reject(new Error(failure)) })
  expect(view.getByText(failure)).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(1900) }); expect(pixel.requests).toHaveLength(0)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) }); expect(pixel.requests).toHaveLength(1)
  await act(async () => { pixel.requests.shift()!.reject(new Error(failure)) })
  await act(async () => { await vi.advanceTimersByTimeAsync(3500) }); expect(pixel.requests).toHaveLength(0)
  await act(async () => { await vi.advanceTimersByTimeAsync(800) }); expect(pixel.requests).toHaveLength(1)
  await act(async () => { pixel.requests.shift()!.resolve({ sourceTimestamps: [0], presented: true }) })
  expect(view.queryByText(failure)).toBeNull(); view.unmount()
})
it('回放分辨率（4.9）：播放时按所选倍数缩小渲染，暂停回到完整；选“暂停时也用此分辨率”后暂停保持；控制条显示当前选择', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; appendVideoEditClip(id)
  const onError = vi.fn(); const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [] }); await vi.advanceTimersByTimeAsync(5) })
  act(() => { setVideoEditPlaybackResolution(id, { resolution: 'quarter' }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5) })
  expect(pixel.scale).not.toHaveBeenCalled()
  expect(view.getByRole('button', { name: '回放分辨率' }).textContent).toContain('1/4')
  act(() => { setVideoEditView(id, { playing: true }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5) })
  expect(pixel.scale).toHaveBeenLastCalledWith(4)
  act(() => { setVideoEditView(id, { playing: false }) })
  for (const request of pixel.requests) await act(async () => { request.resolve({ sourceTimestamps: [] }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5) })
  expect(pixel.scale).toHaveBeenLastCalledWith(1)
  act(() => { setVideoEditPlaybackResolution(id, { fullWhenPaused: false }) })
  for (const request of pixel.requests) await act(async () => { request.resolve({ sourceTimestamps: [] }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5) })
  expect(pixel.scale).toHaveBeenLastCalledWith(4)
  expect(onError).not.toHaveBeenCalled(); view.unmount()
})
it('回放分辨率（4.9）：暂停也用 1/8 时，设为封面先按完整分辨率重画这一帧再取图，取完回到所选分辨率', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; appendVideoEditClip(id)
  setVideoEditPlaybackResolution(id, { resolution: 'eighth', fullWhenPaused: false })
  const toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })))
  HTMLCanvasElement.prototype.toBlob = toBlob as unknown as HTMLCanvasElement['toBlob']
  const onError = vi.fn(); const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => {})
  expect(pixel.scale).toHaveBeenLastCalledWith(8)
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [] }); await vi.advanceTimersByTimeAsync(5) })
  let done = false
  const poster = setVideoEditPosterFrame(id).then(() => { done = true })
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(pixel.scale).toHaveBeenLastCalledWith(1); expect(toBlob).not.toHaveBeenCalled()
  await act(async () => { pixel.requests.at(-1)!.resolve({ sourceTimestamps: [] }); await vi.advanceTimersByTimeAsync(20) })
  await act(async () => { await poster })
  expect(done).toBe(true); expect(toBlob).toHaveBeenCalledTimes(1)
  expect((view.getByLabelText('剪辑画面') as HTMLCanvasElement).dataset.renderDivisor).toBe('1')
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(pixel.scale).toHaveBeenLastCalledWith(8)
  expect(onError).not.toHaveBeenCalled(); view.unmount()
})

it('删除唯一空序列时已挂载节目会话安全退出，撤销后可重新挂载', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id; const onError = vi.fn()
  const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { deleteVideoEditSequence(id, owner.activeSequenceId); view.rerender(<VideoEditPreview instance={owner} onError={onError} />) })
  expect(view.getByText('没有序列')).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(20) })
  expect(pixel.dispose).toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
  await act(async () => { undoVideoEdit(id); view.rerender(<VideoEditPreview instance={owner} onError={onError} />) })
  expect(view.getByLabelText('剪辑画面')).toBeTruthy()
  expect(onError).not.toHaveBeenCalled()
})

it('首帧后留出操作窗口，持续交互推迟预热，停稳后预热且卸载不再运行', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const owner = await createVideoEditProject()
  const view = render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ presented: true, sourceTimestamps: [0] }) })
  now = 1000
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(pixel.arm).not.toHaveBeenCalled()
  now = 1200; fireEvent.pointerMove(window)
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(pixel.arm).not.toHaveBeenCalled()
  now = 1400
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(pixel.arm).toHaveBeenCalledOnce()
  view.unmount(); now = 5000
  await act(async () => { await vi.advanceTimersByTimeAsync(50) })
  expect(pixel.arm).toHaveBeenCalledOnce()
})


it('松开拖动在最终停帧回执前预热，回到曾预热的位置仍重新准备；首帧操作窗口不提前预热', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const owner = await createVideoEditProject(); const id = owner.document.id
  const view = render(<VideoEditPreview instance={owner} onError={vi.fn()} />)
  await act(async () => {})
  await act(async () => { pixel.requests[0].resolve({ presented: true, sourceTimestamps: [0] }) })
  now = 500
  await act(async () => { setVideoEditView(id, { frame: 10, scrubbing: true }); setVideoEditView(id, { scrubbing: false }) })
  expect(pixel.arm).not.toHaveBeenCalled()
  now = 1400
  await act(async () => { setVideoEditView(id, { frame: 20, scrubbing: true }); await vi.advanceTimersByTimeAsync(5) })
  const pending = pixel.requests.at(-1)!
  await act(async () => { setVideoEditView(id, { scrubbing: false }) })
  expect(pixel.arm).toHaveBeenLastCalledWith(20)
  const count = pixel.arm.mock.calls.length
  // Leaving and returning to the same position has invalidated the old Worker schedule, even before another picture arrives.
  await act(async () => { setVideoEditView(id, { frame: 40, scrubbing: true }); setVideoEditView(id, { frame: 20, scrubbing: false }) })
  expect(pixel.arm).toHaveBeenCalledTimes(count + 1)
  expect(pixel.arm).toHaveBeenLastCalledWith(20)
  view.unmount()
  await act(async () => { pending.resolve({ presented: true, sourceTimestamps: [0] }); await vi.advanceTimersByTimeAsync(5) })
  expect(pixel.arm).toHaveBeenCalledTimes(count + 1)
})
