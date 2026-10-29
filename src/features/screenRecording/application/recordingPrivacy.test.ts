// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve, sep } from 'node:path'
import { harnessDocumentStore, installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { executeUiApplicationCapability } from '@/features/application-control'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { privacyCandidateSchema } from '@/core/screenRecording/privacy'
import { getPlatform } from '@/platform'
import { readRecordingUnderstanding } from './recordingUnderstandingService'
import { analyzeRecordingPrivacy } from './recordingPrivacyService'
import { editableRecordingUnderstanding, UNDERSTANDING_PROPERTY } from './recordingUnderstandingFields'
beforeEach(() => installHarnessNativeStorage())
afterEach(() => { vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function setup(status: 'stopped' | 'interrupted' = 'stopped') {
  const id = crypto.randomUUID(), content = createRecordingDocument(); content.sessionId = id; content.status = status
  content.understanding.director = { goal: '演示', confirmed: false, voice: { modelId: 'mock', options: {} }, narration: [{ stepId: 'step', text: '演示', picture: '界面' }] }
  content.understanding.operationScript.steps = [{ id: 'step', title: '演示', startUs: 3000000, endUs: 4000000, operations: [{ target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_preset': 'paper' } }], narrationIds: [], wait: { kind: 'capability_completed', settleMs: 100 }, blockedReason: null }]
  content.media = [{ id: 'screen', kind: 'screen', path: resolve(sep, 'fixture', 'screen.mp4'), monoUs: 3000000, durationUs: 1000000 }]
  await getPlatform().documents.createDocument({ id, kind: 'screen_recording', container: { kind: 'user' }, name: '隐私候选测试', content })
  const candidate = privacyCandidateSchema.parse({ id: 'private', mediaId: 'screen', kind: 'email', hint: '••••', fingerprint: 'a'.repeat(64), startUs: 3000000, endUs: 3500000, status: 'pending', samples: [{ monoUs: 3000000, box: [.1, .2, .4, .1], confidence: .99 }] })
  vi.spyOn(getPlatform().smartRegions, 'onPrivacyProgress').mockReturnValue(() => undefined)
  vi.spyOn(getPlatform().smartRegions, 'detectSensitiveText').mockResolvedValue({ privacy: { candidates: [candidate], warnings: [] }, frames: 10, inferredFrames: 1 })
  vi.spyOn(getPlatform().screenRecording, 'capture').mockResolvedValue({ events: [], nextOffset: null })
  return { id, sessionRef: { kind: 'screen_recording.session', id }, ref: { kind: 'screen_recording.understanding', id } }
}
it.each(['stopped', 'interrupted'] as const)('内置默认OCR正式发现/分析→读回→批量确认→撤销→过期基线拒绝（%s 会话）', async status => {
  const { id, sessionRef, ref } = await setup(status), app = createApplicationHarness()
  try {
    expect(app.session.list().some(d => d.id === 'detect_screen_recording_sensitive_text')).toBe(true)
    const generated = await app.requireResult('detect_screen_recording_sensitive_text', { sessionRef })
    expect(generated).toMatchObject({ verified: true, candidates: 1, undoRef: expect.any(String) })
    expect(getPlatform().smartRegions.detectSensitiveText).toHaveBeenCalledWith({ requestId: expect.any(String), source: resolve(sep, 'fixture', 'screen.mp4'), mediaId: 'screen', startUs: 0, endUs: 1000000, originUs: 3000000 })
    expect((harnessDocumentStore().stored(id)?.content as ReturnType<typeof createRecordingDocument>).understanding.privacy.candidates).toMatchObject([{ id: 'private', status: 'pending' }])
    const read = await app.read(ref, [UNDERSTANDING_PROPERTY]), value = structuredClone(editableRecordingUnderstanding((await readRecordingUnderstanding(id)).content.understanding))
    value.privacy.candidates[0].status = 'accepted'
    const input = { summary: '确认打码', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { [UNDERSTANDING_PROPERTY]: value } }] }
    const changed = await app.requireResult('change_application_entities', input, read.revisions as Record<string, number>)
    expect((await readRecordingUnderstanding(id)).content.understanding.privacy.candidates[0].status).toBe('accepted')
    const beforeStale = await readRecordingUnderstanding(id)
    expect(await app.call('change_application_entities', input, read.revisions as Record<string, number>)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await readRecordingUnderstanding(id)).toEqual(beforeStale)
    await app.requireResult('undo_application_changes', { undoRef: changed.undoRef })
    expect((await readRecordingUnderstanding(id)).content.understanding.privacy.candidates[0].status).toBe('pending')
    const afterUndo = await readRecordingUnderstanding(id)
    expect(await app.call('change_application_entities', input, read.revisions as Record<string, number>)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await readRecordingUnderstanding(id)).toEqual(afterUndo)
  } finally { app.dispose() }
})
it('分析期间并发修改、取消和保存失败不覆盖原理解', async () => {
  const { id, sessionRef } = await setup(), app = createApplicationHarness()
  try {
    const controller = new AbortController(); controller.abort(new Error('取消'))
    await expect(analyzeRecordingPrivacy(id, controller.signal)).rejects.toThrow('取消')
    vi.spyOn(getPlatform().documents, 'saveDocument').mockRejectedValueOnce(new Error('磁盘已满'))
    expect((await app.call('detect_screen_recording_sensitive_text', { sessionRef })).ok).toBe(false)
    expect((await readRecordingUnderstanding(id)).content.understanding.privacy.candidates).toEqual([])
    vi.mocked(getPlatform().smartRegions.detectSensitiveText).mockImplementationOnce(async () => {
      const read = await readRecordingUnderstanding(id)
      await getPlatform().documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: { ...read.content, markers: [{ id: 'marker', monoUs: 3100000, note: '并发修改' }] } })
      return { privacy: { candidates: [], warnings: [] }, frames: 10, inferredFrames: 1 }
    })
    expect((await app.call('detect_screen_recording_sensitive_text', { sessionRef })).ok).toBe(false)
    expect((await readRecordingUnderstanding(id)).content.markers).toHaveLength(1)
  } finally { app.dispose() }
})
it('重新生成步骤保留已确认隐私；越界候选无法写入', async () => {
  const { id, sessionRef, ref } = await setup(), app = createApplicationHarness()
  try {
    await app.requireResult('detect_screen_recording_sensitive_text', { sessionRef })
    const original = (await readRecordingUnderstanding(id)).content.understanding
    await app.requireResult('understand_screen_recording', { sessionRef, detectVisuals: false })
    expect((await readRecordingUnderstanding(id)).content.understanding.privacy).toEqual(original.privacy)
    const invalid = structuredClone(editableRecordingUnderstanding((await readRecordingUnderstanding(id)).content.understanding)); invalid.privacy.candidates[0].endUs = 6000000
    expect((await app.change(ref, { [UNDERSTANDING_PROPERTY]: invalid })).ok).toBe(false)
  } finally { app.dispose() }
})

it('真实 UI 执行入口按录制文档版本确认和撤销，拒绝旧版本而不比较宿主计数', async () => {
  const { id, sessionRef, ref } = await setup(), app = createApplicationHarness(), signal = new AbortController().signal
  try {
    expect(await executeUiApplicationCapability({ id: 'detect_screen_recording_sensitive_text', version: 1, input: { sessionRef } }, signal)).toMatchObject({ ok: true })
    const before = await readRecordingUnderstanding(id), value = structuredClone(editableRecordingUnderstanding(before.content.understanding))
    value.privacy.candidates[0].status = 'accepted'
    const invocation = { id: 'change_application_entities', version: 2, expectedRevisions: { screen_recording: before.meta.revision }, input: { summary: '界面确认打码', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { [UNDERSTANDING_PROPERTY]: value } }] } }
    const result = await executeUiApplicationCapability(invocation, signal)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect((await readRecordingUnderstanding(id)).content.understanding.privacy.candidates[0].status).toBe('accepted')
    expect(await executeUiApplicationCapability(invocation, signal)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    if (!result.ok) throw new Error(result.error.message)
    expect(await executeUiApplicationCapability({ id: 'undo_application_changes', version: 1, input: { undoRef: result.data.undoRef } }, signal)).toMatchObject({ ok: true })
    expect((await readRecordingUnderstanding(id)).content.understanding.privacy.candidates[0].status).toBe('pending')
  } finally { app.dispose() }
})
