// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { changeVideoEditMulticamCamera, createVideoEditMulticam } from '@/core/videoEdit/multicam'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditInstance } from '../application/videoEditService'
import type { VideoEditRenderTransportOptions } from '../engine/videoEditRenderTransport'
import { VideoEditRenderWorkerError } from '../engine/videoEditGpuFailure'
import { VideoEditMulticamView } from './VideoEditMulticamView'
import { UI_OPTION_ITEM_ACTIVE_CLASS } from '@/components/ui/styleTokens'

interface FakeSession { document: VideoEditComposition; options: VideoEditRenderTransportOptions; updateDocument: ReturnType<typeof vi.fn>; setRenderDivisor: ReturnType<typeof vi.fn>; stopPlayback: ReturnType<typeof vi.fn> }
const boundary = vi.hoisted(() => ({ sessions: [] as unknown[], present: vi.fn(), dispose: vi.fn(async () => undefined), switched: vi.fn(), info: vi.fn(), view: new Set<() => void>(), domain: new Set<() => void>(), revision: 0, command: {} as object, proxies: {} as Record<string, { key: string }>, instances: [] as unknown[] }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  terminalError = undefined; terminated = false
  updateDocument = vi.fn(async () => undefined); setRenderDivisor = vi.fn(async () => undefined); stopPlayback = vi.fn()
  present = (...args: unknown[]) => boundary.present(...args)
  dispose = boundary.dispose
  constructor(readonly document: unknown, readonly options: unknown) { boundary.sessions.push(this) }
} }))
vi.mock('../application/videoEditService', async () => {
  const { videoEditComposition } = await import('@/core/videoEdit/document')
  const listen = (listeners: Set<() => void>) => (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  return { subscribeVideoEditView: listen(boundary.view), subscribeVideoEditDomain: listen(boundary.domain), videoEditViewRevision: () => boundary.revision, videoEditDomainRevision: () => boundary.revision,
    getActiveVideoEditSequence: (instance: VideoEditInstance) => videoEditComposition(instance.document, instance.activeSequenceId), videoEditProgramCommandIdentity: () => boundary.command, listVideoEditInstances: () => boundary.instances }
})
vi.mock('../application/videoEditMulticam', async () => {
  const { activeVideoEditClips, videoEditComposition } = await import('@/core/videoEdit/document')
  const { videoEditMulticamSource } = await import('@/core/videoEdit/multicam')
  return { switchVideoEditMulticam: boundary.switched, videoEditProgramMulticam: (instance: VideoEditInstance) => {
    const clip = activeVideoEditClips(videoEditComposition(instance.document, instance.activeSequenceId), instance.frame).filter(value => videoEditMulticamSource(instance.document, value)).at(-1)
    const source = clip && videoEditMulticamSource(instance.document, clip)
    return clip && source ? { clip, source } : undefined
  } }
})
vi.mock('../application/videoEditProxy', () => ({ getVideoEditProxySources: () => boundary.proxies }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: boundary.info, warn: vi.fn(), error: vi.fn() }) }))

const presented = { presented: true, renderCached: false, renderElapsedMs: 5 }
let now = 1000
function fixture(): VideoEditInstance {
  const document = createVideoEditTestDocument('多机位监视器')
  document.media = Array.from({ length: 4 }, (_, index) => ({ id: `media-${index}`, name: `机位${index}`, path: `D:/${index}.mp4`, kind: 'video' as const, width: 3840, height: 2160, durationSeconds: 20, hasAudio: true }))
  document.items = document.media.map(media => ({ id: `item-${media.id}`, name: media.name, kind: 'video' as const, mediaId: media.id }))
  document.sequences[0].width = 3840; document.sequences[0].height = 2160
  const result = createVideoEditMulticam(document, document.sequences[0].id, { name: '同步', sync: 'in_points', cameras: document.items.map(item => ({ itemId: item.id })), audioCameraIndex: 0 })
  const parent = result.document.sequences[0]
  parent.clips = [{ ...makeVideoEditItemClip(result.document, result.itemId, parent.id, { frame: 30, duration: 300 }), sourceInUs: 2_000_000 }]
  // 播放头 100 帧：源序列 2 秒 + 70 帧 = 第 130 帧。
  const instance = { document: result.document, activeSequenceId: parent.id, frame: 100, playing: false, playbackDirection: 1 } as unknown as VideoEditInstance
  boundary.instances = [instance]
  return instance
}
const settle = (): Promise<void> => act(async () => { for (let index = 0; index < 50; index++) await Promise.resolve() })
const notify = (listeners: Set<() => void>): Promise<void> => act(async () => { boundary.revision++; for (const listener of [...listeners]) listener(); for (let index = 0; index < 50; index++) await Promise.resolve() })
const session = (index = 0): FakeSession => boundary.sessions[index] as FakeSession

beforeEach(() => {
  vi.useFakeTimers(); now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  boundary.sessions = []; boundary.present.mockReset().mockResolvedValue(presented); boundary.dispose.mockReset().mockResolvedValue(undefined); boundary.switched.mockReset(); boundary.info.mockReset(); boundary.command = {}; boundary.proxies = {}
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { configurable: true, value() { return { from: this } } })
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 960, height: 540 } as DOMRect)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('四个机位只建一个渲染会话、全部画布交给它；暂停时按播放头定位；切机位只换高亮，不重建会话；卸载时释放会话', async () => {
  const instance = fixture()
  const view = render(<VideoEditMulticamView instance={instance} onError={vi.fn()} />)
  await settle()
  expect(boundary.sessions).toHaveLength(1)
  const { options, document } = session()
  expect(options.gridCells?.surfaces).toHaveLength(4); expect(options.gridCells?.columns).toBe(2)
  expect(options.proxyProjectId).toBe(instance.document.id)
  const cameras = instance.document.sequences.find(sequence => sequence.multicam)!.multicam!.cameras
  expect(document.clips.map(clip => clip.multicamCameraId)).toEqual(cameras.map(camera => camera.id))
  // 格子显示 960 像素宽，4K 机位缩小 4 倍。
  expect(session().setRenderDivisor).toHaveBeenCalledWith(4)
  expect(boundary.present).toHaveBeenCalledOnce(); expect(boundary.present).toHaveBeenLastCalledWith(130, false, false, undefined, undefined)
  const selected = (): string[] => view.getAllByRole('button').filter(button => UI_OPTION_ITEM_ACTIVE_CLASS.split(' ').every(name => button.classList.contains(name))).map(button => button.getAttribute('aria-label')!)
  expect(selected()).toEqual([`切换到机位1 ${cameras[0].name}`])
  fireEvent.click(view.getByRole('button', { name: `切换到机位3 ${cameras[2].name}` }))
  expect(boundary.switched.mock.lastCall?.[1]).toBe(cameras[2].id)
  const parentId = instance.activeSequenceId
  const switched = changeVideoEditMulticamCamera(instance.document, parentId, instance.document.sequences.find(sequence => sequence.id === parentId)!.clips[0].id, cameras[2].id)
  instance.document = { ...instance.document, revision: 1, sequences: instance.document.sequences.map(sequence => sequence.id === parentId ? switched : sequence) }
  await notify(boundary.domain)
  expect(selected()).toEqual([`切换到机位3 ${cameras[2].name}`])
  expect(boundary.sessions).toHaveLength(1); expect(session().updateDocument).not.toHaveBeenCalled(); expect(boundary.present).toHaveBeenCalledOnce()
  view.unmount()
  expect(boundary.dispose).toHaveBeenCalledOnce()
})

it('正向播放跟随节目时钟：各帧按节目的呈现时刻走顺序播放，停下时撤下未上屏的播放帧并写出帧统计', async () => {
  const instance = fixture()
  boundary.present.mockImplementation(async (_frame: number, _sequential: boolean, _scrubbing: boolean, _deadline: number | undefined, submitted?: () => void) => { submitted?.(); return presented })
  render(<VideoEditMulticamView instance={instance} onError={vi.fn()} />)
  await settle()
  boundary.present.mockClear()
  // 起播：节目先画起点帧（不按时钟），之后每呈现一帧就把播放头设到这一帧。
  instance.playing = true
  await notify(boundary.view)
  expect(boundary.present).not.toHaveBeenCalled()
  for (let frame = 101; frame <= 104; frame++) { now = 1000 + (frame - 101) * 1000 / 30; instance.frame = frame; await notify(boundary.view) }
  const calls = [...boundary.present.mock.calls]
  expect(calls.every(call => call[1] === true && call[2] === false)).toBe(true)
  // 节目第 101 帧在 1000ms 呈现：网格第 131 帧（源时间）在同一时刻，此后逐帧连续、每帧晚 1/30 秒。
  expect(calls.map(call => call[0])).toEqual(Array.from({ length: calls.length }, (_, index) => 131 + index))
  calls.forEach((call, index) => expect(call[3] - performance.timeOrigin).toBeCloseTo(1000 + index * 1000 / 30, 2))
  instance.playing = false
  await notify(boundary.view)
  expect(session().stopPlayback).toHaveBeenCalledWith(calls.at(-1)![0])
  const stats = boundary.info.mock.calls.find(call => call[1]?.event === 'video_edit.multicam.playback.stats')?.[1].context
  expect(stats).toMatchObject({ cameras: 4, fps: 30, droppedFrames: 0, presentedFrames: calls.length })
  expect(stats.actualFps).toBeGreaterThan(0)
  // 暂停后按精确方式重画播放头所在帧。
  expect(boundary.present).toHaveBeenLastCalledWith(134, false, false, undefined, undefined)
})

it('Worker 故障退避重建会话（换一批新画布）并恢复播放头，连续失败后使用现有重试入口', async () => {
  boundary.present.mockRejectedValue(new VideoEditRenderWorkerError('退出'))
  const instance = fixture()
  const view = render(<VideoEditMulticamView instance={instance} onError={vi.fn()} />)
  await settle()
  expect(boundary.sessions).toHaveLength(1); expect(boundary.dispose).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(249) }); expect(boundary.sessions).toHaveLength(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) }); await settle(); expect(boundary.sessions).toHaveLength(2)
  expect(session(1).options.gridCells!.surfaces.every((surface, index) => surface !== session(0).options.gridCells!.surfaces[index])).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(500) }); await settle(); expect(boundary.sessions).toHaveLength(3)
  expect(view.getByText('退出')).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) }); expect(boundary.sessions).toHaveLength(3)
  boundary.present.mockResolvedValue(presented)
  await act(async () => { fireEvent.click(view.getByRole('button', { name: /Retry|重试/ })) })
  await settle()
  expect(boundary.sessions).toHaveLength(4); expect(boundary.present).toHaveBeenLastCalledWith(130, false, false, undefined, undefined)
  expect(view.queryByText('退出')).toBeNull()
})

it('故障跨过 30 秒窗口后重新取得两次恢复预算', async () => {
  boundary.present.mockRejectedValueOnce(new VideoEditRenderWorkerError('退出'))
  const instance = fixture()
  const view = render(<VideoEditMulticamView instance={instance} onError={vi.fn()} />)
  await settle()
  await act(async () => { await vi.advanceTimersByTimeAsync(250) }); await settle(); expect(boundary.sessions).toHaveLength(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  boundary.present.mockRejectedValue(new VideoEditRenderWorkerError('再次退出')); instance.frame++
  await notify(boundary.view); expect(boundary.sessions).toHaveLength(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) }); await settle(); expect(boundary.sessions).toHaveLength(3)
  await act(async () => { await vi.advanceTimersByTimeAsync(500) }); await settle(); expect(boundary.sessions).toHaveLength(4)
  expect(view.getByText('再次退出')).toBeTruthy()
})

it('恢复时新会话等旧会话释放完才建立，不重叠占用设备', async () => {
  let finish!: () => void
  boundary.dispose.mockImplementationOnce(() => new Promise<undefined>(resolve => { finish = () => resolve(undefined) }))
  boundary.present.mockRejectedValueOnce(new VideoEditRenderWorkerError('退出'))
  render(<VideoEditMulticamView instance={fixture()} onError={vi.fn()} />)
  await settle()
  expect(boundary.dispose).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(250) }); await settle()
  expect(boundary.dispose).toHaveBeenCalledOnce(); expect(boundary.sessions).toHaveLength(1)
  await act(async () => { finish() }); await settle()
  expect(boundary.sessions).toHaveLength(2)
})

it('代理生成好或失效（普通视图通知）时重新选代理：同一份网格内容再交一次完整更新，合成尺寸不变', async () => {
  const instance = fixture()
  render(<VideoEditMulticamView instance={instance} onError={vi.fn()} />)
  await settle()
  expect(session().setRenderDivisor).toHaveBeenCalledTimes(1)
  boundary.proxies = { 'media-1': { key: 'a'.repeat(64) } }
  await notify(boundary.view)
  expect(boundary.sessions).toHaveLength(1)
  expect(session().updateDocument).toHaveBeenCalledTimes(2)
  expect(session().updateDocument.mock.calls[1][0]).toBe(session().updateDocument.mock.calls[0][0])
  expect(session().setRenderDivisor).toHaveBeenCalledTimes(1)
  boundary.proxies = {}
  await notify(boundary.view)
  expect(session().updateDocument).toHaveBeenCalledTimes(4)
})

it('窗口转到后台时结束播放、不再出帧，回到前台接着跟随节目时钟', async () => {
  const instance = fixture()
  let hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  onTestFinished(() => { delete (document as { hidden?: boolean }).hidden })
  boundary.present.mockImplementation(async (_frame: number, _sequential: boolean, _scrubbing: boolean, _deadline: number | undefined, submitted?: () => void) => { submitted?.(); return presented })
  render(<VideoEditMulticamView instance={instance} onError={vi.fn()} />)
  await settle()
  instance.playing = true
  for (let frame = 101; frame <= 102; frame++) { now = 1000 + (frame - 101) * 1000 / 30; instance.frame = frame; await notify(boundary.view) }
  hidden = true
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); for (let index = 0; index < 50; index++) await Promise.resolve() })
  expect(session().stopPlayback).toHaveBeenCalledOnce()
  const requests = boundary.present.mock.calls.length
  for (let frame = 103; frame <= 105; frame++) { now = 1000 + (frame - 101) * 1000 / 30; instance.frame = frame; await notify(boundary.view) }
  expect(boundary.present).toHaveBeenCalledTimes(requests)
  hidden = false
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); for (let index = 0; index < 50; index++) await Promise.resolve() })
  expect(boundary.present.mock.calls.length).toBeGreaterThan(requests)
  expect(boundary.present.mock.calls.slice(requests).every(call => call[1] === true)).toBe(true)
})

it('格子尺寸为 0 时不建会话、不出帧；有了尺寸再开始；换到缩放比例不同的屏幕时重选缩小倍数', async () => {
  const resized: Array<() => void> = []
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized.push(callback) } observe(): void {} disconnect(): void {} })
  const resolution: Array<() => void> = []
  vi.stubGlobal('matchMedia', vi.fn(() => ({ addEventListener: (_type: string, listener: () => void) => { resolution.push(listener) }, removeEventListener: vi.fn() })))
  const rect = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 0, height: 0 } as DOMRect)
  render(<VideoEditMulticamView instance={fixture()} onError={vi.fn()} />)
  await settle()
  expect(boundary.sessions).toHaveLength(0); expect(boundary.present).not.toHaveBeenCalled()
  rect.mockReturnValue({ width: 960, height: 540 } as DOMRect)
  await act(async () => { for (const callback of resized) callback(); for (let index = 0; index < 50; index++) await Promise.resolve() })
  expect(boundary.sessions).toHaveLength(1); expect(session().setRenderDivisor).toHaveBeenLastCalledWith(4)
  vi.stubGlobal('devicePixelRatio', 2)
  await act(async () => { for (const listener of [...resolution]) listener(); for (let index = 0; index < 50; index++) await Promise.resolve() })
  expect(session().setRenderDivisor).toHaveBeenLastCalledWith(2)
})
