// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, registerHarnessAudioEditProject, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { quickProcessAudioEdit } from './audioEditApplicationService'
import { flushAudioEditProject, loadAudioEditProject, releaseAudioEditProject, undoAudioEditProject } from './audioEditProjectInstances'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'

afterEach(async () => { vi.restoreAllMocks(); await flushAudioEditProject('quick'); releaseAudioEditProject('quick'); uninstallHarnessNativeStorage() })
it('quick processing commits fillers and pauses as one undo step and is idempotent', async () => {
  installHarnessNativeStorage()
  registerHarnessAudioEditProject({ id: 'quick', name: '录音', source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }, transcript: [{ id: 'filler', text: '嗯', startFrame: 0, endFrame: 500, included: true, locked: false, granularity: 'word' }], referenceScript: '', suggestions: [], vstEnabled: false, revision: 1, createdAt: 1, updatedAt: 1 })
  const instance = await loadAudioEditProject('quick')
  vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockImplementation(async () => ({ revision: instance.persistedRevision, suggestions: [{ id: 'pause', kind: 'long_silence', evidence: 'audio', startFrame: 1000, endFrame: 3000, title: '停顿', detail: '', confidence: 'high', status: 'pending', blockIds: [] }] }))
  await quickProcessAudioEdit('quick')
  expect(editedDurationFrames(buildProjectAudioEditTimeline(instance.document))).toBe(1850)
  expect(instance.past).toHaveLength(1)
  await quickProcessAudioEdit('quick')
  expect(instance.past).toHaveLength(1)
  undoAudioEditProject('quick')
  expect(editedDurationFrames(buildProjectAudioEditTimeline(instance.document))).toBe(4000)
  expect(instance.document.transcript[0].included).toBe(true)
})
