// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { documentKindRegistry } from '@/core/documents/kinds'
import { audioEditProjectToDocumentContent } from '@/core/audioEdit/documentContent'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands } from '@/features/documents/documentSessionTestKit'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { quickProcessAudioEdit } from './audioEditApplicationService'
import { loadAudioEditProject, resetAudioEditProjectInstancesForTests, setAudioEditDocumentRegistryForTests, undoAudioEditProject } from './audioEditProjectInstances'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'

afterEach(async () => { vi.restoreAllMocks(); await resetAudioEditProjectInstancesForTests(); setAudioEditDocumentRegistryForTests(null); uninstallHarnessNativeStorage() })
it('quick processing commits fillers and pauses as one undo step and is idempotent', async () => {
  installHarnessNativeStorage()
  const commands = new FakeDocumentCommands()
  setAudioEditDocumentRegistryForTests(new DocumentSessionRegistry({ commands, prompter: createScriptedPrompter(), kinds: documentKindRegistry }))
  commands.seed({ kind: 'audio_edit', id: 'quick', name: '录音', content: audioEditProjectToDocumentContent({ id: 'quick', name: '录音', source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }, transcript: [{ id: 'filler', text: '嗯', startFrame: 0, endFrame: 500, included: true, locked: false, granularity: 'word' }], referenceScript: '', suggestions: [], vstEnabled: false, revision: 1, createdAt: 1, updatedAt: 1 }) })
  const instance = await loadAudioEditProject('quick')
  // 主进程读文件分析：返回的版本就是文件版本（处理前已把修改写完）
  vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockImplementation(async () => ({ revision: instance.session.documentMeta.revision, suggestions: [{ id: 'pause', kind: 'long_silence', evidence: 'audio', startFrame: 1000, endFrame: 3000, title: '停顿', detail: '', confidence: 'high', status: 'pending', blockIds: [] }] }))
  await quickProcessAudioEdit('quick')
  expect(editedDurationFrames(buildProjectAudioEditTimeline(instance.document))).toBe(1850)
  expect(instance.past).toHaveLength(1)
  expect((commands.stored('quick')!.content as { cuts: unknown[] }).cuts.length).toBeGreaterThan(0)
  await quickProcessAudioEdit('quick')
  expect(instance.past).toHaveLength(1)
  undoAudioEditProject('quick')
  expect(editedDurationFrames(buildProjectAudioEditTimeline(instance.document))).toBe(4000)
  expect(instance.document.transcript[0].included).toBe(true)
})
