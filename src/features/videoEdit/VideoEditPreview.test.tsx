// @vitest-environment jsdom
import { act, render, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditClip, appendVideoEditMedia, appendVideoEditSequence, switchVideoEditSequence, closeVideoEditProject, createVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, setVideoEditTimelineView, undoVideoEdit } from './application/videoEditService'
import { VideoEditPreview } from './VideoEditPreview'
import { registerVideoEditSourcePresenter, updateVideoEditSource } from './application/videoEditSource'
import { resetVideoEditPlaybackResolutionCache, setVideoEditPlaybackResolution } from './application/videoEditPlaybackResolution'
import { setVideoEditPosterFrame } from './application/videoEditProgramCapture'
const pixel = vi.hoisted(() => ({ requests: [] as Array<{ frame: number; sequential?: boolean; submitted?: () => void; resolve: (value: { sourceTimestamps: number[]; presented?: boolean }) => void; reject: (error: Error) => void }>, sessions: 0, update: vi.fn(), dispose: vi.fn(), mixAudio: vi.fn(), scale: vi.fn() }))
vi.mock('./application/videoEditProjectCover', () => ({ saveVideoEditPosterCover: vi.fn(async () => undefined) }))
vi.mock('./engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  constructor() { pixel.sessions++ }
  updateDocument = pixel.update
  invalidateDocument = vi.fn()
  dispose = pixel.dispose
  mixAudio = pixel.mixAudio
  setRenderDivisor = pixel.scale
  setSmartRegions = vi.fn()
  present(frame: number, sequential?: boolean, _scrubbing?: boolean, _deadline?: number, submitted?: () => void) { return new Promise((resolve, reject) => pixel.requests.push({ frame, sequential, resolve, reject, submitted })) }
} }))
beforeEach(() => {
  vi.useFakeTimers(); installHarnessNativeStorage(); pixel.requests = []; pixel.sessions = 0; pixel.update.mockResolvedValue(undefined); pixel.dispose.mockResolvedValue(undefined); pixel.scale.mockReset(); pixel.scale.mockResolvedValue(undefined); localStorage.clear(); resetVideoEditPlaybackResolutionCache()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/preview.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.stubGlobal('OffscreenCanvas', class {})
  HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn(() => ({} as OffscreenCanvas))
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('文字工具接管原标注模式，退出文字后节目工具可继续切换', async () => {
  const instance = await createVideoEditProject(); const view = render(<VideoEditPreview instance={instance} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() })
  const openMenu = (): void => { const button = view.getByRole('button', { name: '更多节目操作' }); if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button) }
  openMenu(); fireEvent.click(view.getByRole('button', { name: '点标注' }))
  expect(view.getByLabelText('标注文字')).toBeTruthy()
  act(() => setVideoEditTimelineView(instance.document.id, { tool: 'type' }))
  expect(view.getByLabelText('节目文字工具')).toBeTruthy(); expect(view.queryByLabelText('标注文字')).toBeNull()
  openMenu(); fireEvent.click(view.getByRole('button', { name: '移动画面' }))
  expect(instance.tool).toBe('select'); expect(view.queryByLabelText('节目文字工具')).toBeNull()
  act(() => setVideoEditTimelineView(instance.document.id, { tool: 'type' }))
  expect(view.getByLabelText('节目文字工具')).toBeTruthy(); view.unmount()
})
it('画面标注捕获原选区和时间，后续定位及指针取消不标注新目标', async () => {
  const instance = (await createVideoEditProject())!; appendVideoEditClip(instance.document.id)
  const onError = vi.fn(); const view = render(<VideoEditPreview instance={instance} onError={onError} />)
  await act(async () => { await Promise.resolve() })
  const canvas = view.getByLabelText('剪辑画面'); const host = canvas.parentElement!
  Object.defineProperty(host, 'setPointerCapture', { value: vi.fn() })
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 180, right: 320, width: 320, height: 180, toJSON: () => ({}) })
  fireEvent.click(view.getByRole('button', { name: '更多节目操作' })); fireEvent.click(view.getByRole('button', { name: '点标注' }))
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
  act(() => { editVideoSequence(instance.document.id, instance.activeSequenceId, document => ({ ...document, clips: document.clips.map(clip => ({ ...clip, brightness: .5 })) })) })
  await act(async () => { pixel.requests[0].resolve({ sourceTimestamps: [0], presented: false }) })
  expect(canvas.dataset.presentedFrame).toBeUndefined()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(pixel.sessions).toBe(1); expect(pixel.update).toHaveBeenCalledWith(getActiveVideoEditSequence(instance))
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

it('真实画面移动连续更新只写一次历史，改选区和Escape取消原手势', async () => {
  const owner = (await createVideoEditProject())!; appendVideoEditClip(owner.document.id); const clipId = owner.selection!; const onError = vi.fn()
  const view = render(<VideoEditPreview instance={owner} onError={onError} />)
  await act(async () => { await Promise.resolve() }); const host = view.getByLabelText('剪辑画面').parentElement!
  Object.defineProperty(host, 'setPointerCapture', { value: vi.fn() })
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 180))
  fireEvent.click(view.getByRole('button', { name: '更多节目操作' })); fireEvent.click(view.getByRole('button', { name: '移动画面' }))
  const send = (type: string, x: number, y: number) => fireEvent(host, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }))
  const history = owner.past.length
  send('pointerdown', 32, 18); send('pointermove', 64, 36); send('pointermove', 96, 54)
  expect(getActiveVideoEditSequence(owner).clips[0]).toMatchObject({ x: .2, y: .2 }); expect(owner.past).toHaveLength(history)
  send('pointerup', 96, 54); expect(owner.past).toHaveLength(history + 1)
  act(() => undoVideoEdit(owner.document.id)); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0)
  send('pointerdown', 0, 0); send('pointermove', 32, 18); fireEvent.keyDown(window, { key: 'Escape' }); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0)
  send('pointerdown', 0, 0); send('pointermove', 32, 18); act(() => setVideoEditTimelineView(owner.document.id, { selectedClipIds: [] })); send('pointerup', 32, 18)
  expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0); expect(owner.selection).not.toBe(clipId); expect(onError).not.toHaveBeenCalled()
})

function installAudioGraph(resume: () => Promise<void> = async () => {}) {
  const nodes: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = []
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  const createGain = vi.fn(() => ({ ...node(), gain: { value: 1 } }))
  const createSource = vi.fn(() => { const source = { ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: undefined }; nodes.push(source); return source })
  const close = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('AudioContext', class {
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
