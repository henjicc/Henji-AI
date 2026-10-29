// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { documentKindRegistry } from '@/core/documents/kinds'
import { audioEditProjectToDocumentContent } from '@/core/audioEdit/documentContent'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands } from '@/features/documents/documentSessionTestKit'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { cleanProjectAudioEditRetakes, processProjectAudioEditBreaths, quickProcessAudioEdit } from './audioEditApplicationService'
import { loadAudioEditProject, resetAudioEditProjectInstancesForTests, setAudioEditDocumentRegistryForTests, undoAudioEditProject } from './audioEditProjectInstances'
import { setAudioEditBlocks } from '@/core/audioEdit/edits'
import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from '@/core/audioEdit/types'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'

afterEach(async () => { vi.restoreAllMocks(); await resetAudioEditProjectInstancesForTests(); setAudioEditDocumentRegistryForTests(null); uninstallHarnessNativeStorage() })
it('quick processing commits fillers and pauses as one undo step and is idempotent', async () => {
  installHarnessNativeStorage()
  const commands = new FakeDocumentCommands()
  setAudioEditDocumentRegistryForTests(new DocumentSessionRegistry({ commands, prompter: createScriptedPrompter(), kinds: documentKindRegistry }))
  commands.seed({ kind: 'audio_edit', id: 'quick', name: '录音', content: audioEditProjectToDocumentContent({ id: 'quick', name: '录音', source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }, transcript: [{ id: 'filler', text: '嗯', startFrame: 0, endFrame: 500, included: true, locked: false, granularity: 'word' }], referenceScript: '', suggestions: [], revision: 1, createdAt: 1, updatedAt: 1 }) })
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

/** 两遍“所以综合来看”，第一遍 [500,1460)，停顿 [1460,2300)，第二遍 [2300,…)；采样率 1000。 */
function retakeTranscript(): AudioEditTranscriptBlock[] {
  const words: AudioEditTranscriptBlock[] = []
  let at = 500
  for (const [index, text] of ['所以', '综合', '来看', '挺好。', '所以', '综合', '来看', '很好', '的'].entries()) {
    if (index === 4) at = 2300
    const length = text.replace('。', '').length * 120
    words.push({ id: `w${index}`, text, startFrame: at, endFrame: at + length, included: true, locked: false, granularity: 'word' })
    at += length
  }
  return words
}
const energy = { resolutionMs: 10, thresholdDb: -60, highThresholdDb: -70, pauses: [{ startMs: 0, endMs: 500, cutMs: 250 }, { startMs: 1460, endMs: 2300, cutMs: 1880 }, { startMs: 3500, endMs: 4000, cutMs: 3750 }] }

it('去掉重念：删掉前一遍和其间停顿，只留最后一遍，一步撤销；在文字里恢复时停顿也回来', async () => {
  installHarnessNativeStorage()
  const commands = new FakeDocumentCommands()
  setAudioEditDocumentRegistryForTests(new DocumentSessionRegistry({ commands, prompter: createScriptedPrompter(), kinds: documentKindRegistry }))
  commands.seed({ kind: 'audio_edit', id: 'retake', name: '录音', content: audioEditProjectToDocumentContent({ id: 'retake', name: '录音', source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }, transcript: retakeTranscript(), referenceScript: '', suggestions: [], revision: 1, createdAt: 1, updatedAt: 1 }) })
  const instance = await loadAudioEditProject('retake')
  const detect = vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockImplementation(async () => ({ revision: instance.session.documentMeta.revision, suggestions: [], energy }))
  const result = await cleanProjectAudioEditRetakes('retake')
  expect(detect).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'retake', energy: {} }))
  expect(result.count).toBe(1)
  expect(instance.document.transcript.filter((block) => !block.included).map((block) => block.text).join('')).toBe('所以综合来看挺好。')
  // 从第一遍开头删到第二遍开头前 120 毫秒（两遍间的停顿只留一口气）
  expect(result.shortenedMs).toBe(2180 - 500)
  expect(instance.past).toHaveLength(1)
  const stored = commands.stored('retake')!.content as { suggestions: Array<{ kind: string; status: string }> }
  expect(stored.suggestions).toEqual([expect.objectContaining({ kind: 'retake', status: 'applied' })])
  expect((await cleanProjectAudioEditRetakes('retake')).count).toBe(0)
  const restored = setAudioEditBlocks(instance.document, ['w1'], true)
  expect(restored.cuts).toEqual([])
  undoAudioEditProject('retake')
  expect(editedDurationFrames(buildProjectAudioEditTimeline(instance.document))).toBe(4000)
})

it('快速处理在有逐词转写时先去掉重念，再压缩停顿，整批一个撤销步骤', async () => {
  installHarnessNativeStorage()
  const commands = new FakeDocumentCommands()
  setAudioEditDocumentRegistryForTests(new DocumentSessionRegistry({ commands, prompter: createScriptedPrompter(), kinds: documentKindRegistry }))
  commands.seed({ kind: 'audio_edit', id: 'quick-retake', name: '录音', content: audioEditProjectToDocumentContent({ id: 'quick-retake', name: '录音', source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }, transcript: retakeTranscript(), referenceScript: '', suggestions: [], revision: 1, createdAt: 1, updatedAt: 1 }) })
  const instance = await loadAudioEditProject('quick-retake')
  vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockImplementation(async (request) => ({ revision: instance.session.documentMeta.revision, suggestions: [], ...(request.energy ? { energy } : {}) }))
  const result = await quickProcessAudioEdit('quick-retake')
  expect(result.retakeCount).toBe(1)
  expect(instance.past).toHaveLength(1)
  expect(instance.document.suggestions.map((item) => [item.kind, item.status])).toEqual([['retake', 'applied']])
})

it('词块手改后删呼吸不撤回已有的 3.9 秒删除，缺少电平时也不恢复；手写同前缀剪切原样保留', async () => {
  installHarnessNativeStorage()
  const commands = new FakeDocumentCommands()
  setAudioEditDocumentRegistryForTests(new DocumentSessionRegistry({ commands, prompter: createScriptedPrompter(), kinds: documentKindRegistry }))
  const document: AudioEditProjectDocument = {
    id: 'breath-rerun', name: '口播', source: { mediaType: 'audio', sourcePath: 'voice.wav', audioPath: 'voice.wav', sampleRate: 1000, channels: 1, durationFrames: 7000 },
    referenceScript: '', suggestions: [], revision: 1, createdAt: 1, updatedAt: 1,
    transcript: [
      { id: 'a', text: '词。', startFrame: 0, endFrame: 1000, included: true, locked: false, granularity: 'word' },
      // 用户调整的词时间盖住旧自动删除：删除仍是独立决定，重算不能靠清空剪切恢复它。
      { id: 'b', text: '词', startFrame: 2000, endFrame: 4900, included: true, locked: false, granularity: 'word' },
      { id: 'c', text: '词', startFrame: 5000, endFrame: 7000, included: true, locked: false, granularity: 'word' },
    ],
    cuts: [
      { id: 'gap:1000', startFrame: 1000, endFrame: 4900, enabled: true, reason: 'silence' },
      { id: 'gap:5100', startFrame: 5100, endFrame: 5200, enabled: true, reason: 'manual', mode: 'mute' },
      { id: 'breath:5300', startFrame: 5300, endFrame: 5400, enabled: false, reason: 'manual' },
    ],
  }
  commands.seed({ kind: 'audio_edit', id: document.id, name: document.name, content: audioEditProjectToDocumentContent(document) })
  const instance = await loadAudioEditProject(document.id)
  vi.spyOn(getPlatform().audioEdit, 'detectBreaths').mockResolvedValue({ version: 2, model: 'respiro-en', durationMs: 7000, breaths: [] })
  const detect = vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockImplementation(async () => ({
    revision: instance.session.documentMeta.revision, suggestions: [], energy: { resolutionMs: 10, thresholdDb: -48, highThresholdDb: -72, pauses: [], levels: { wideDb: Array(700).fill(-30) } },
  }))
  const manual = instance.document.cuts!.filter((cut) => cut.reason === 'manual')
  expect((await processProjectAudioEditBreaths(document.id)).shortenedMs).toBe(0)
  const once = instance.document.cuts
  expect(editedDurationFrames(buildProjectAudioEditTimeline(instance.document))).toBe(3100)
  expect((await processProjectAudioEditBreaths(document.id)).shortenedMs).toBe(0)
  expect(instance.document.cuts).toEqual(once)
  detect.mockResolvedValueOnce({ revision: instance.session.documentMeta.revision, suggestions: [] })
  expect((await processProjectAudioEditBreaths(document.id)).shortenedMs).toBe(0)
  expect(instance.document.cuts).toEqual(once)
  await processProjectAudioEditBreaths(document.id, 'keep')
  expect(instance.document.cuts!.filter((cut) => cut.reason === 'manual')).toEqual(manual)
})
