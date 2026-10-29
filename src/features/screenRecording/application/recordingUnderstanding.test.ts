// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve, sep } from 'node:path'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession, listApplicationCapabilities } from '@/features/application-control/applicationCapabilityService'
import { getPlatform } from '@/platform'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { readRecordingUnderstanding, analyzeRecording } from './recordingUnderstandingService'
import { UNDERSTANDING_ENTITY, UNDERSTANDING_PROPERTY } from './recordingUnderstandingFields'
import type { RecordingUnderstanding } from '@/core/screenRecording/understanding'
import * as paidApproval from '@/services/paidApproval'
import { resetAudioEditProjectInstancesForTests } from '@/features/audioEdit/application/audioEditProjectInstances'

beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { await resetAudioEditProjectInstancesForTests(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
function app() {
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: crypto.randomUUID() }))
  const call = (id: string, input: unknown, expectedRevisions?: Record<string, number>) => session.execute({ id, version: listApplicationCapabilities().find(v => v.id === id)!.version, input, expectedRevisions }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  const requireResult = async (id: string, input: unknown, revisions?: Record<string, number>) => { const result = await call(id, input, revisions); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.data }
  return { call, requireResult }
}
async function fixture() {
  const id = crypto.randomUUID(), content = createRecordingDocument()
  content.sessionId = id; content.status = 'stopped'
  content.media = [{ id: 'screen', kind: 'screen', path: resolve(sep, 'fixture', 'screen.mp4'), monoUs: 3000000, durationUs: 10000000 }]
  content.eventPages = [{ path: resolve(sep, 'fixture', 'events.capture.json'), firstSequence: 0, lastSequence: 1 }]
  await getPlatform().documents.createDocument({ id, kind: 'screen_recording', name: '理解测试', container: { kind: 'user' }, content })
  vi.spyOn(getPlatform().screenRecording, 'capture').mockResolvedValue({ events: [
    { kind: 'control', action: 'start', eventId: 'start', monoUs: 3000000, recordingUs: 0, seq: 0, timeline: null, clockSegmentRef: 'clock', unavailableReason: 'static' },
    { kind: 'control', action: 'stop', eventId: 'stop', monoUs: 13000000, recordingUs: 10000000, seq: 1, timeline: null, clockSegmentRef: 'clock', unavailableReason: 'static' },
  ], nextOffset: null })
  vi.spyOn(getPlatform().sceneDetection, 'detect').mockResolvedValue({ cutsSeconds: [], contentIdentity: 'a'.repeat(64), stillness: [{ startSeconds: 0, endSeconds: 10 }] })
  vi.spyOn(getPlatform().sceneDetection, 'validate').mockResolvedValue(true)
  return { id, ref: { kind: UNDERSTANDING_ENTITY, id }, sessionRef: { kind: 'screen_recording.session', id } }
}
it('正式能力生成→读回→人工校正→通用撤销；生成也在同一事务撤销', async () => {
  const { id, ref, sessionRef } = await fixture(), api = app()
  const generated = await api.requireResult('understand_screen_recording', { sessionRef })
  expect(generated).toMatchObject({ verified: true, steps: 1, candidates: 2, undoRef: expect.any(String) })
  const read = await api.requireResult('read_application_entity', { ref, propertyIds: [UNDERSTANDING_PROPERTY] })
  const value = structuredClone((read.properties as Record<string, RecordingUnderstanding>)[UNDERSTANDING_PROPERTY])
  value.steps[0].title = '人工校正'; value.candidates[0].status = 'rejected'
  const input = { summary: '校正步骤', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { [UNDERSTANDING_PROPERTY]: value } }] }
  const edited = await api.requireResult('change_application_entities', input, read.revisions as Record<string, number>)
  expect((await readRecordingUnderstanding(id)).content.understanding.steps[0].title).toBe('人工校正')
  expect((await api.call('change_application_entities', input, read.revisions as Record<string, number>)).ok).toBe(false)
  await api.requireResult('undo_application_changes', { undoRef: edited.undoRef })
  expect((await readRecordingUnderstanding(id)).content.understanding.steps[0].title).not.toBe('人工校正')
  // Older undo receipts carry their original revision; generation undo is verified separately below.
  const second = await api.requireResult('understand_screen_recording', { sessionRef, detectVisuals: false })
  await api.requireResult('undo_application_changes', { undoRef: second.undoRef })
  expect((await readRecordingUnderstanding(id)).content.understanding.candidates).toHaveLength(2)
})
it('会话元数据与理解正文分开，越界修改被拒绝', async () => {
  const { id, ref, sessionRef } = await fixture()
  const api = app(); await api.requireResult('understand_screen_recording', { sessionRef })
  const metadata = await app().requireResult('read_application_entity', { ref: sessionRef, propertyIds: [] })
  expect(JSON.stringify(metadata)).not.toContain('录制步骤')
  const saved = await readRecordingUnderstanding(id), value = structuredClone(saved.content.understanding)
  value.steps[0].endUs = 14000000
  const input = { summary: '越界', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { [UNDERSTANDING_PROPERTY]: value } }] }
  expect((await api.call('change_application_entities', input)).ok).toBe(false)
  expect((await api.call('change_application_entities', input, { screen_recording: saved.meta.revision })).ok).toBe(false)
  expect((await readRecordingUnderstanding(id)).content.understanding).toEqual(saved.content.understanding)
})
it('已有模拟转写按声音分段起点映射到录制时钟，停顿使用本地能量证据', async () => {
  const { id } = await fixture()
  const read = await readRecordingUnderstanding(id)
  const path = resolve(sep, 'fixture', 'voice.wav')
  await getPlatform().documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: { ...read.content, devices: { microphone: {}, systemAudio: false }, media: [...read.content.media, { id: 'mic', kind: 'microphone', path, monoUs: 3500000, durationUs: 9000000 }] } })
  await getPlatform().documents.createDocument({ kind: 'audio_edit', container: { kind: 'user' }, name: '模拟转写', content: {
    source: { mediaType: 'audio', sourcePath: path, audioPath: path, durationFrames: 432000, sampleRate: 48000, channels: 1 }, referenceScript: '',
    transcript: [{ id: 'word', text: '打开编辑器', startFrame: 0, endFrame: 96000, included: true, locked: false, granularity: 'segment' }], suggestions: [], vstEnabled: false, cuts: [], processorChain: [],
  } })
  vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockResolvedValue({ revision: 0, suggestions: [{ id: 'silence', kind: 'long_silence', title: '停顿', detail: '', startFrame: 96000, endFrame: 432000, blockIds: [], confidence: 'high', status: 'pending' }] })
  const asr = vi.spyOn(getPlatform().audioEdit, 'transcribe')
  const result = await analyzeRecording(id, { transcribe: false, detectVisuals: true }, new AbortController().signal)
  expect(result.understanding.transcript[0]).toMatchObject({ startUs: 3500000, endUs: 5500000, text: '打开编辑器' })
  expect(result.understanding.candidates.find(v => v.kind === 'wait')).toMatchObject({ startUs: 5500000, endUs: 12500000 })
  expect(asr).not.toHaveBeenCalled()
})
it('显式转写复用付费审批，拒绝后零识别派发并保留口播恢复引用', async () => {
  const { id } = await fixture(), read = await readRecordingUnderstanding(id), path = resolve(sep, 'fixture', 'paid.wav')

  await getPlatform().documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: { ...read.content, devices: { microphone: {}, systemAudio: false }, media: [...read.content.media, { id: 'mic', kind: 'microphone', path, monoUs: 3000000, durationUs: 10000000 }] } })
  vi.spyOn(getPlatform().audioEdit, 'probeSource').mockResolvedValue({ mediaType: 'audio', sourcePath: path, audioPath: path, durationFrames: 480000, sampleRate: 48000, channels: 1 })
  vi.spyOn(getPlatform().audioEdit, 'preflightTranscription').mockResolvedValue({ modelId: 'offline-fixture', requiresConfirmation: true })
  const gate = vi.spyOn(paidApproval, 'withPaidOperation').mockRejectedValueOnce(new Error('拒绝付费'))
  const asr = vi.spyOn(getPlatform().audioEdit, 'transcribe')
  await expect(analyzeRecording(id, { transcribe: true, detectVisuals: false }, new AbortController().signal)).rejects.toThrow('拒绝付费')
  expect(gate).toHaveBeenCalledWith(expect.objectContaining({ category: 'recognition', documentId: id }), expect.any(Function), expect.any(AbortSignal))
  expect(asr).not.toHaveBeenCalled()
  const audio = await getPlatform().documents.listDocuments({ kind: 'audio_edit', includeDrafts: true })
  expect(audio).toHaveLength(1)
  expect((await readRecordingUnderstanding(id)).content.understanding.steps).toHaveLength(0)
})
it('导演会话重新理解保留已知旁白和确认脚本，不为 TTS 再付费转写或伪造音频文档', async () => {
  const { id } = await fixture(), read = await readRecordingUnderstanding(id), path = resolve(sep, 'fixture', 'tts.wav')

  const content = read.content
  content.media.push({ id: 'mic', kind: 'microphone', path, monoUs: 3000000, durationUs: 2000000 })
  content.understanding.director = { goal: '演示设置', confirmed: true, voice: { modelId: 'mock', options: {} }, narration: [{ stepId: 's', text: '打开设置。', picture: '设置界面' }] }
  content.understanding.transcript = [{ id: 's', text: '打开设置。', startUs: 3000000, endUs: 5000000, granularity: 'segment', mediaId: 'mic' }]
  content.understanding.steps = [{ id: 's', title: '打开设置', description: '', startUs: 3000000, endUs: 13000000, signal: 'capability', eventIds: [] }]
  content.understanding.operationScript = { steps: [{ id: 's', title: '打开设置', startUs: 3000000, endUs: 13000000, narrationIds: ['s'], operations: [{ target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_preset': 'paper' } }], wait: { kind: 'capability_completed', settleMs: 700 }, blockedReason: null }] }
  await getPlatform().documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content })
  vi.spyOn(getPlatform().audioEdit, 'probeSource').mockResolvedValue({ mediaType: 'audio', sourcePath: path, audioPath: path, durationFrames: 96000, sampleRate: 48000, channels: 1 })
  vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockResolvedValue({ revision: 0, suggestions: [] })
  const asr = vi.spyOn(getPlatform().audioEdit, 'transcribe'), gate = vi.spyOn(paidApproval, 'withPaidOperation')
  const result = await analyzeRecording(id, { transcribe: true, detectVisuals: false }, new AbortController().signal)
  expect(result.understanding).toMatchObject({ director: content.understanding.director, operationScript: content.understanding.operationScript, transcript: content.understanding.transcript, steps: content.understanding.steps })
  expect(asr).not.toHaveBeenCalled(); expect(gate).not.toHaveBeenCalled()
  expect(result.audioUpdates).toEqual([])
  const api = app()
  const saved = await api.requireResult('understand_screen_recording', { sessionRef: { kind: 'screen_recording.session', id }, transcribe: true, detectVisuals: false })
  expect(saved.verified).toBe(true)
  const value = await api.requireResult('read_application_entity', { ref: { kind: UNDERSTANDING_ENTITY, id }, propertyIds: [UNDERSTANDING_PROPERTY] })
  expect(JSON.stringify(value.properties)).not.toContain('confirmed')

})
it('取消、保存失败与分析期间修改不覆盖原结果，不启动转写', async () => {
  const { id, sessionRef } = await fixture(), api = app()
  const asr = vi.spyOn(getPlatform().audioEdit, 'transcribe')
  const cancelled = new AbortController(); cancelled.abort(new Error('取消测试'))
  await expect(analyzeRecording(id, { transcribe: false, detectVisuals: true }, cancelled.signal)).rejects.toThrow('取消测试')
  const initial = (await readRecordingUnderstanding(id)).content
  const save = vi.spyOn(getPlatform().documents, 'saveDocument').mockRejectedValueOnce(new Error('磁盘已满'))
  expect((await api.call('understand_screen_recording', { sessionRef })).ok).toBe(false)
  expect((await readRecordingUnderstanding(id)).content).toEqual(initial)
  save.mockRestore()
  vi.mocked(getPlatform().sceneDetection.detect).mockImplementationOnce(async () => {
    const read = await readRecordingUnderstanding(id)
    await getPlatform().documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: { ...read.content, markers: [{ id: 'new', monoUs: 4000000, note: '并发修改' }] } })
    return { cutsSeconds: [], contentIdentity: 'a'.repeat(64), stillness: [] }
  })
  expect((await api.call('understand_screen_recording', { sessionRef })).ok).toBe(false)
  expect((await readRecordingUnderstanding(id)).content.understanding.steps).toHaveLength(0)
  expect(asr).not.toHaveBeenCalled()
})
