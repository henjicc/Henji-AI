// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { useAudioEditPreview } from './useAudioEditPreview'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'

const { prepare } = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioEdit: { preparePreviewChunk: prepare } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))
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
    id: 'preview', name: '口播', referenceScript: '', suggestions: [], vstEnabled: false,
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
  useAudioEditPlaybackStore.setState({ ready: false, preparing: false, playing: false, mode: 'edited', sourceFrame: 0, outputFrame: 0, activeBlockId: null, error: null })
})
afterEach(() => { vi.unstubAllGlobals() })

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
  expect(useAudioEditPlaybackStore.getState().playing).toBe(true)
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
