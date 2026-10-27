// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { useAudioEditPreview } from './useAudioEditPreview'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { audioEditScrub } from './audioEditScrub'

interface FakeScrubEngine {
  calls: Array<[string, ...unknown[]]>
  source?: { read(start: number, frames: number): Promise<Float32Array[]>; frames: number; sampleRate: number }
  onError?: (error: unknown) => void
}
const { prepare, flushProject, scrubEngines } = vi.hoisted(() => ({ prepare: vi.fn(), flushProject: vi.fn(async () => undefined), scrubEngines: [] as FakeScrubEngine[] }))
vi.mock('@/services/audioScrub/audioScrubEngine', () => ({ AudioScrubEngine: class {
  calls: Array<[string, ...unknown[]]> = []
  source?: FakeScrubEngine['source']
  onError?: (error: unknown) => void
  constructor(options: { onError?: (error: unknown) => void }) { this.onError = options.onError; scrubEngines.push(this) }
  attach() { this.calls.push(['attach']) }
  setSource(source: FakeScrubEngine['source']) { this.source = source; this.calls.push(['source']) }
  rest(seconds: number) { this.calls.push(['rest', seconds]) }
  move(seconds: number) { this.calls.push(['move', seconds]) }
  step(seconds: number) { this.calls.push(['step', seconds]) }
  stop() { this.calls.push(['stop']) }
} }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({ audioEdit: { preparePreviewChunk: prepare } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn(), debug: vi.fn() }) }))
vi.mock('../application/audioEditProjectInstances', () => ({ flushAudioEditProject: flushProject }))
let node: FakeNode
function captureNode(value: FakeNode) { node = value }
class FakeContext {
  state = 'suspended'
  currentTime = 0
  createGain() { return { gain: { setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() } }
  createDynamicsCompressor() { return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() } }
  audioWorklet = { addModule: async () => undefined }
  destination = {}
  async resume() { this.state = 'running' }
  async suspend() { this.state = 'suspended' }
  async close() { this.state = 'closed' }
}
class FakeNode {
  port = { postMessage: vi.fn(), onmessage: (_event: { data: object }) => undefined }
  constructor() { captureNode(this) }
  connect() {}
  disconnect() {}
}
function project(): AudioEditProjectDocument {
  return {
    id: 'preview', name: '口播', referenceScript: '', suggestions: [],
    source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', durationFrames: 480000, sampleRate: 48000, channels: 1 },
    transcript: [{ id: 'word', text: '句子', startFrame: 0, endFrame: 480000, included: true, locked: false, granularity: 'segment' }],
    createdAt: 1, updatedAt: 1, revision: 1,
  }
}
function chunk({ sourceStartFrame, frameCount }: { sourceStartFrame: number; frameCount: number }) {
  return { sourceStartFrame, sourceEndFrame: sourceStartFrame + frameCount, channels: 1, pcm: new Float32Array(frameCount).buffer }
}
function generation() { return node.port.postMessage.mock.calls.filter(([message]) => message.type === 'reset').at(-1)![0].generation as number }
beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
  prepare.mockReset().mockImplementation(async (request) => chunk(request))
  flushProject.mockClear()
  scrubEngines.length = 0
  useAudioEditPlaybackStore.setState({ ready: false, preparing: false, playing: false, mode: 'edited', sourceFrame: 0, outputFrame: 0, activeBlockId: null, error: null })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('首段录音替换空素材并改变采样率时保留录音末尾的播放头', async () => {
  const empty = { ...project(), source: { ...project().source, durationFrames: 0 }, transcript: [] }
  const hook = renderHook(({ value }) => useAudioEditPreview(value), { initialProps: { value: empty } })
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().ready).toBe(true))
  act(() => useAudioEditPlaybackStore.getState().updatePosition(44100, 44100, null))
  hook.rerender({ value: { ...empty, source: { ...empty.source, sampleRate: 44100, durationFrames: 88200 } } })
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().ready).toBe(true))
  expect(useAudioEditPlaybackStore.getState().sourceFrame).toBe(44100)
  hook.unmount()
})

it('emits zero PCM for muted spans and restores original audio in source mode', async () => {
  const fixture = project()
  fixture.cuts = [{ id: 'mute', reason: 'manual', enabled: true, mode: 'mute', startFrame: 0, endFrame: 48000 }]
  prepare.mockImplementation(async (request) => ({ ...chunk(request), pcm: new Float32Array(request.frameCount).fill(0.5).buffer }))
  const hook = renderHook(() => useAudioEditPreview(fixture))
  await waitFor(() => expect(node.port.postMessage.mock.calls.some(([message]) => message.type === 'chunk')).toBe(true))
  const muted = node.port.postMessage.mock.calls.find(([message]) => message.type === 'chunk' && message.sourceStartFrame === 0)![0]
  expect(new Float32Array(muted.pcm).every((sample) => sample === 0)).toBe(true)
  expect(prepare.mock.calls.every(([request]) => request.sourceStartFrame >= 48000)).toBe(true)
  act(() => useAudioEditPlaybackStore.getState().setMode('source'))
  await waitFor(() => expect(prepare.mock.calls.some(([request]) => request.sourceStartFrame === 0)).toBe(true))
  hook.unmount()
})

it('replaces an in-flight old seek with the latest seek and ignores stale positions', async () => {
  let resolve!: (value: ReturnType<typeof chunk>) => void
  prepare.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const hook = renderHook(() => useAudioEditPreview(project()))
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
  const oldGeneration = generation()
  act(() => { hook.result.current.seekSourceFrame(240000); hook.result.current.seekSourceFrame(336000) })
  await act(async () => resolve(chunk({ sourceStartFrame: 0, frameCount: 48000 })))
  await waitFor(() => expect(prepare.mock.calls[1][0].sourceStartFrame).toBe(336000))
  act(() => node.port.onmessage({ data: { type: 'position', generation: oldGeneration, sourceFrame: 100, consumedFrames: 100 } }))
  expect(useAudioEditPlaybackStore.getState().sourceFrame).toBe(336000)
  expect(node.port.postMessage.mock.calls.filter(([message]) => message.type === 'chunk').every(([message]) => message.sourceStartFrame >= 336000)).toBe(true)
  hook.unmount()
})

it('drains the final buffered samples before stopping and can replay', async () => {
  const fixture = project()
  fixture.source.durationFrames = 48000
  const hook = renderHook(() => useAudioEditPreview(fixture))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  await act(() => hook.result.current.togglePlayback())
  expect(useAudioEditPlaybackStore.getState()).toMatchObject({ playing: true, error: null })
  act(() => {
    node.port.onmessage({ data: { type: 'position', generation: generation(), sourceFrame: 48000, consumedFrames: 48000 } })
    node.port.onmessage({ data: { type: 'starved', generation: generation(), consumedFrames: 48000 } })
  })
  expect(useAudioEditPlaybackStore.getState()).toMatchObject({ playing: false, outputFrame: 48000 })
  await act(() => hook.result.current.togglePlayback())
  expect(useAudioEditPlaybackStore.getState()).toMatchObject({ playing: true, sourceFrame: 0 })
  hook.unmount()
})

it('pauses even while a chunk is being prepared and never resumes from the old promise', async () => {
  let resolve!: (value: ReturnType<typeof chunk>) => void
  prepare.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const hook = renderHook(() => useAudioEditPreview(project()))
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
  let play!: Promise<void>
  act(() => { play = hook.result.current.togglePlayback() })
  await act(() => hook.result.current.togglePlayback())
  await act(async () => { resolve(chunk({ sourceStartFrame: 0, frameCount: 48000 })); await play })
  act(() => node.port.onmessage({ data: { type: 'position', generation: generation(), sourceFrame: 500, consumedFrames: 500 } }))
  expect(useAudioEditPlaybackStore.getState()).toMatchObject({ playing: false, sourceFrame: 0 })
  hook.unmount()
})

it('keeps audio on save-only revisions and jumps to the next retained range after deletion', async () => {
  const fixture = project()
  const hook = renderHook(({ value }) => useAudioEditPreview(value), { initialProps: { value: fixture } })
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  const initialGeneration = generation()
  hook.rerender({ value: { ...fixture, revision: 2 } })
  expect(generation()).toBe(initialGeneration)
  hook.rerender({ value: { ...fixture, transcript: [{ ...fixture.transcript[0], endFrame: 96000, included: false }] } })
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().sourceFrame).toBe(96000))
  act(() => hook.result.current.seekSourceFrame(24000))
  expect(useAudioEditPlaybackStore.getState().sourceFrame).toBe(96000)
  hook.unmount()
})

it.each([
  ['删除', { id: 'cut', reason: 'manual', enabled: true, mode: 'delete', startFrame: 60000, endFrame: 90000 }],
  ['静音', { id: 'cut', reason: 'manual', enabled: true, mode: 'mute', startFrame: 60000, endFrame: 90000 }],
] as const)('%s只改拼接表：沿用已读出的声音从当前位置重来，不再重新要声音、也不再先保存', async (_label, cut) => {
  const fixture = { ...project(), gainRegions: [{ id: 'gain', startFrame: 0, endFrame: 48000, gainDb: -6, fadeInFrames: 0, fadeOutFrames: 0, enabled: true }] }
  const hook = renderHook(({ value }) => useAudioEditPreview(value), { initialProps: { value: fixture } })
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  const requested = prepare.mock.calls.length
  expect(requested).toBeGreaterThan(0)
  expect(flushProject).toHaveBeenCalledTimes(1)
  const before = generation()
  hook.rerender({ value: { ...fixture, cuts: [cut] } })
  await waitFor(() => expect(generation()).toBeGreaterThan(before))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  // 新拼接表从当前位置重新排队，排进来的就是剪后的声音
  expect(node.port.postMessage.mock.calls.some(([message]) => message.type === 'chunk' && message.generation === generation())).toBe(true)
  // 剪掉一段后缓冲往后多排了一点，可能要新的一秒；但已经读出的每一秒都不再要第二遍
  const fetched = new Set(prepare.mock.calls.slice(0, requested).map(([request]) => request.sourceStartFrame))
  expect(prepare.mock.calls.slice(requested).filter(([request]) => fetched.has(request.sourceStartFrame))).toEqual([])
  expect(flushProject).toHaveBeenCalledTimes(1)
  hook.unmount()
})

it('invalidates buffered edited audio after gain or repair changes', async () => {
  const fixture = project()
  const hook = renderHook(({ value }) => useAudioEditPreview(value), { initialProps: { value: fixture } })
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  const initial = generation()
  hook.rerender({ value: { ...fixture, gainRegions: [{ id: 'gain', startFrame: 0, endFrame: 48000, gainDb: -6, fadeInFrames: 0, fadeOutFrames: 0, enabled: true }] } })
  await waitFor(() => expect(generation()).toBeGreaterThan(initial))
  const gainGeneration = generation()
  hook.rerender({ value: { ...fixture, repairs: [{ id: 'repair', kind: 'declick', startFrame: 100, endFrame: 200, lowHz: 0, highHz: 24000, strength: 1, enabled: true }] } })
  await waitFor(() => expect(generation()).toBeGreaterThan(gainGeneration))
  expect(prepare.mock.calls.at(-1)?.[0].mode).toBe('edited')
  hook.unmount()
})

const scrub = () => scrubEngines.at(-1)!
const scrubCalls = (kind?: string) => scrub().calls.filter(([name]) => !kind || name === kind)

it('擦洗经共用引擎：按下先备声音、拖动逐次送位置（秒）、松手静音并从松手处重排正常播放', async () => {
  const hook = renderHook(() => useAudioEditPreview(project()))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  expect(scrubCalls('attach')).toHaveLength(1)
  const before = generation()
  const controls = audioEditScrub('preview')!
  await act(async () => { controls.start(24000); controls.move(30000); controls.move(36000) })
  expect(scrubCalls('rest')).toEqual([['rest', 0.5]])
  expect(scrubCalls('move')).toEqual([['move', 0.625], ['move', 0.75]])
  // 擦洗期间正常播放的队列作废，播放头跟着走
  expect(generation()).toBeGreaterThan(before)
  expect(useAudioEditPlaybackStore.getState().sourceFrame).toBe(36000)
  await act(async () => controls.end())
  expect(scrubCalls('stop').length).toBeGreaterThan(0)
  expect(useAudioEditPlaybackStore.getState()).toMatchObject({ playing: false, sourceFrame: 36000 })
  hook.unmount()
  expect(audioEditScrub('preview')).toBeUndefined()
})

it('单击定位不出声，键盘单步出一小段，播放中拖动仍然只跳转正常播放', async () => {
  const hook = renderHook(() => useAudioEditPreview(project()))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  await act(async () => hook.result.current.seekSourceFrame(24000))
  expect(scrubCalls('move').length + scrubCalls('step').length).toBe(0)
  await act(async () => audioEditScrub('preview')!.step(36000))
  expect(scrubCalls('step')).toEqual([['step', 0.75]])
  await act(() => hook.result.current.togglePlayback())
  const before = generation()
  await act(async () => { audioEditScrub('preview')!.start(36000); audioEditScrub('preview')!.move(48000) })
  expect(generation()).toBeGreaterThan(before)
  expect(scrubCalls('move')).toHaveLength(0)
  expect(useAudioEditPlaybackStore.getState()).toMatchObject({ playing: true, sourceFrame: 48000 })
  hook.unmount()
})

it('挂起设备恢复中快速连点只发起一次恢复，暂停不挂起且旧回执不恢复播放', async () => {
  let done!: () => void
  const resume = vi.spyOn(FakeContext.prototype, 'resume').mockImplementation(function (this: FakeContext) {
    return new Promise<void>(resolve => { done = () => { this.state = 'running'; resolve() } })
  })
  const suspend = vi.spyOn(FakeContext.prototype, 'suspend')
  const hook = renderHook(() => useAudioEditPreview(project()))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  let first!: Promise<void>, second!: Promise<void>
  act(() => { first = hook.result.current.togglePlayback() })
  await act(() => hook.result.current.togglePlayback())
  act(() => { second = hook.result.current.togglePlayback() })
  await act(() => hook.result.current.togglePlayback())
  await act(async () => { done(); await Promise.all([first, second]) })
  expect(resume).toHaveBeenCalledTimes(1)
  expect(suspend).not.toHaveBeenCalled()
  expect(useAudioEditPlaybackStore.getState().playing).toBe(false)
  expect(node.port.postMessage.mock.calls.filter(([message]) => message.type === 'playing').at(-1)?.[0].value).toBe(false)
  hook.unmount()
})

it.each(['source', 'edited'] as const)('擦洗声音沿 %s 试听的取样模式读取，剪后试听里删掉的部分不占擦洗位置', async mode => {
  const fixture = { ...project(), transcript: [{ ...project().transcript[0], endFrame: 96000, included: false }, { id: 'kept', text: '保留', startFrame: 96000, endFrame: 480000, included: true, locked: false, granularity: 'segment' as const }] }
  const hook = renderHook(() => useAudioEditPreview(fixture, 4))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  act(() => useAudioEditPlaybackStore.getState().setMode(mode))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  prepare.mockClear()
  // 读一段正常播放还没缓冲到的位置（擦洗声音第 6.25 秒）
  await act(async () => { await scrub().source!.read(300000, 4800) })
  expect(prepare.mock.calls.length).toBeGreaterThan(0)
  expect(prepare.mock.calls.every(([request]) => request.mode === mode)).toBe(true)
  await act(async () => audioEditScrub('preview')!.step(120000))
  // 源 2.5 秒：原始试听就是 2.5 秒；剪后试听删掉了前 2 秒，是擦洗声音的 0.5 秒
  expect(scrubCalls('step').at(-1)).toEqual(['step', mode === 'source' ? 2.5 : 0.5])
  hook.unmount()
})

it('擦洗读取失败显示错误，下一次拖动或单步清掉这条错误', async () => {
  const hook = renderHook(() => useAudioEditPreview(project()))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  act(() => scrub().onError?.(new Error('块读取失败')))
  expect(useAudioEditPlaybackStore.getState().error).toBe('块读取失败')
  await act(async () => audioEditScrub('preview')!.step(288000))
  expect(useAudioEditPlaybackStore.getState().error).toBeNull()
  hook.unmount()
})

it('设备恢复途中换模式，旧播放回调只能填充当前模式的数据', async () => {
  let done!: () => void
  vi.spyOn(FakeContext.prototype, 'resume').mockImplementation(function (this: FakeContext) {
    return new Promise<void>(resolve => { done = () => { this.state = 'running'; resolve() } })
  })
  const fixture = project()
  const hook = renderHook(() => useAudioEditPreview(fixture))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  let playing!: Promise<void>
  act(() => { playing = hook.result.current.togglePlayback() })
  act(() => useAudioEditPlaybackStore.getState().setMode('source'))
  await waitFor(() => expect(useAudioEditPlaybackStore.getState().preparing).toBe(false))
  prepare.mockClear()
  act(() => node.port.onmessage({ data: { type: 'position', generation: generation(), sourceFrame: 96000, consumedFrames: 96000 } }))
  await act(async () => { done(); await playing })
  expect(prepare.mock.calls.length).toBeGreaterThan(0)
  expect(prepare.mock.calls.every(([request]) => request.mode === 'source' && request.processing === undefined)).toBe(true)
  hook.unmount()
})
