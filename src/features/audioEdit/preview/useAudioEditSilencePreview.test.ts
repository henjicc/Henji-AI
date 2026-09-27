// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AudioEditProjectDocument, AudioEditSuggestion } from '@/core/audioEdit/types'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { useAudioEditSilencePreview } from './useAudioEditSilencePreview'

const native = vi.hoisted(() => ({ detectSilence: vi.fn(), cancelTask: vi.fn(async () => undefined) }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioEdit: native }) }))
vi.mock('../application/audioEditProjectInstances', () => ({ flushAudioEditProject: async () => undefined }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })
it('debounces changes, cancels outdated work and never applies edits during preview', async () => {
  vi.useFakeTimers()
  let finishOld!: (result: { suggestions: AudioEditSuggestion[] }) => void
  native.detectSilence.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve })).mockResolvedValue({ suggestions: [] })
  const project: AudioEditProjectDocument = { id: 'p', name: '录音', source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', sampleRate: 1000, durationFrames: 4000, channels: 1 }, transcript: [], suggestions: [], referenceScript: '', vstEnabled: false, revision: 1, createdAt: 1, updatedAt: 1 }
  const hook = renderHook(({ value }) => useAudioEditSilencePreview(value, undefined, true), { initialProps: { value: project } })
  await act(() => vi.advanceTimersByTimeAsync(450))
  expect(native.detectSilence).toHaveBeenCalledOnce()
  hook.rerender({ value: { ...project, batchSettings: { ...DEFAULT_AUDIO_EDIT_SETTINGS, noiseDb: -25 } } })
  expect(native.cancelTask).toHaveBeenCalledOnce()
  expect(hook.result.current.pending).toBe(true)
  await act(() => vi.advanceTimersByTimeAsync(450))
  expect(hook.result.current.pending).toBe(false)
  await act(async () => finishOld({ suggestions: [{ id: 'old', kind: 'long_silence', evidence: 'audio', startFrame: 1000, endFrame: 3000, title: '', detail: '', confidence: 'high', status: 'pending', blockIds: [] }] }))
  expect(hook.result.current.ranges).toEqual([])
  expect(project.cuts).toBeUndefined()
  expect(project.suggestions).toEqual([])
})
