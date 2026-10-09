/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'

const mocks = vi.hoisted(() => ({ timelineRender: vi.fn(), notify: vi.fn(), seek: vi.fn(), toggle: vi.fn() }))
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: mocks.notify }) }))
vi.mock('@/features/assistant/store/assistantUiStore', () => ({ openAssistant: vi.fn() }))
vi.mock('@/features/documents/embeddedDocuments', () => ({ useEmbeddedHost: () => null, returnFromEmbedded: vi.fn() }))
vi.mock('./preview/useAudioEditPreview', () => ({ useAudioEditPreview: () => ({ seekSourceFrame: mocks.seek, togglePlayback: mocks.toggle }) }))
vi.mock('./preview/useAudioEditSilencePreview', () => ({ useAudioEditSilencePreview: () => ({ ranges: [], pending: false, error: null }) }))
vi.mock('./AudioEditTimeline', () => ({ AudioEditTimeline: (props: unknown) => { mocks.timelineRender(props); return null }, AudioEditPlaybackModeSwitch: () => null }))
vi.mock('./AudioEditTextTools', () => ({ AudioEditFileMenu: () => null, AudioEditFindReplace: () => null, AudioEditMatchedText: () => null, AudioEditTextEditor: () => null }))
vi.mock('./AudioEditUndoButton', () => ({ AudioEditUndoButton: () => null }))
vi.mock('./AudioEditViewSettings', () => ({ AudioEditViewSettings: () => null }))
vi.mock('@/features/videoEdit/panels/VideoEditSendMenu', () => ({ VideoEditSendMenu: () => null }))
vi.mock('./application/audioEditProjectInstances', () => ({ subscribeAudioEditInstances: () => () => undefined, editAudioEditProject: vi.fn(), flushAudioEditProject: vi.fn(), getAudioEditProjectInstance: vi.fn(), markAudioEditDocumentShown: vi.fn(), undoAudioEditProject: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({ audioEdit: {
  listAsrModels: async () => [], listProcessors: async () => [], listTasks: async () => [],
  verifySource: async () => undefined, extractWaveform: async () => ({ peak: [] }),
} }) }))
vi.mock('@/core/audioEdit/xml', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/audioEdit/xml')>()
  return { ...actual, compileAudioEditXmlTimeline: vi.fn(actual.compileAudioEditXmlTimeline) }
})

import { compileAudioEditXmlTimeline } from '@/core/audioEdit/xml'
import { useAudioEditStore } from './store/audioEditStore'
import AudioEditApp from './AudioEditApp'

afterEach(() => { cleanup(); useAudioEditStore.setState({ project: null }); vi.clearAllMocks() })

it('无关动作不重绘，名称或视图更新不重编交付，剪切更新仍重编', async () => {
  const project: AudioEditProjectDocument = {
    id: 'subscription', name: '口播', referenceScript: '', suggestions: [], vstEnabled: false,
    source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', durationFrames: 480000, sampleRate: 48000, channels: 1 },
    transcript: [], createdAt: 1, updatedAt: 1, revision: 1,
  }
  useAudioEditStore.setState({ project, busy: false, past: [], future: [], selectedBlockIds: [], saveError: null })
  render(<AudioEditApp />)
  await waitFor(() => expect(mocks.timelineRender).toHaveBeenCalled())
  // Drain initial model/waveform/task reads before measuring subscriptions.
  await act(async () => { await Promise.resolve() })
  const renders = mocks.timelineRender.mock.calls.length
  const compilations = vi.mocked(compileAudioEditXmlTimeline).mock.calls.length
  act(() => useAudioEditStore.setState({ toggleBlock: vi.fn() }))
  expect(mocks.timelineRender).toHaveBeenCalledTimes(renders)
  act(() => useAudioEditStore.setState({ project: { ...project, name: '改名', updatedAt: 2 } }))
  expect(compileAudioEditXmlTimeline).toHaveBeenCalledTimes(compilations)
  act(() => useAudioEditStore.setState({ project: { ...project, cuts: [{ id: 'cut', startFrame: 0, endFrame: 48000, mode: 'delete', enabled: true, reason: 'manual' }] } }))
  expect(compileAudioEditXmlTimeline).toHaveBeenCalledTimes(compilations + 1)
})
