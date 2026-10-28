// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve, sep } from 'node:path'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { getPlatform } from '@/platform'
import { createRecordingDocument, recordingDocumentSchema } from '@/core/screenRecording/document'
import { createVideoEditSequence, videoEditDocumentSchema } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { replaceRecordingSteps } from '@/core/screenRecording/replacement'
import { captureRecordingOperations, generateRecordingScript } from '@/core/screenRecording/script'
import type { CaptureEvent } from '@/core/captureLog/events'
import { createVideoEditTestProject, closeAllVideoEdits } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { editVideoProject, undoVideoEdit } from '@/features/videoEdit/application/videoEditService'
import { replaySession } from './recordingReplayService'
import { assertRecordedScriptEdits } from './recordingScriptSource'

beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditTestProject(), id = crypto.randomUUID(), recording = createRecordingDocument()
  recording.sessionId = id; recording.status = 'stopped'
  const path = resolve(sep, 'fixture', 'screen.mp4')
  recording.media = [{ id: 'screen', path, kind: 'screen', monoUs: 0, durationUs: 9000000 }]
  recording.understanding.steps = [0, 1, 2].map(i => ({ id: `step${i}`, title: `步骤${i}`, description: '', signal: 'capability', startUs: i * 3000000, endUs: (i + 1) * 3000000, eventIds: [] }))
  const ref = { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.document.sequences[0].id}` }
  const events: CaptureEvent[] = []
  for (let i = 0; i < 3; i++) {
    const callId = crypto.randomUUID(), operations = captureRecordingOperations('change_application_entities', { summary: '改名', changes: [{ kind: 'set_properties', target: ref, entityType: ref.kind, properties: { 'video_edit.sequence.name': `步骤${i}` } }] })!
    recording.scriptCapture.calls.push({ callId, operations })
    for (const phase of ['started', 'completed'] as const) events.push({ kind: 'capability', callId, capability: 'change_application_entities', targets: [ref], phase, monoUs: i * 3000000 + 1, seq: events.length, recordingUs: i * 3000000 + 1, timeline: null, clockSegmentRef: 'clock', unavailableReason: 'static', eventId: crypto.randomUUID() })
  }
  recording.scriptCapture.baselines.push({ documentId: owner.document.id, content: structuredClone(owner.document) })
  recording.understanding.operationScript = generateRecordingScript(recording.understanding, events, recording.scriptCapture)
  recording.understanding.operationScript.steps.forEach(step => { step.wait.settleMs = 100 })
  await getPlatform().documents.createDocument({ id, kind: 'screen_recording', name: '重放测试', container: { kind: 'user' }, content: recording })
  vi.spyOn(getPlatform().screenRecording, 'capture').mockImplementation(async request => request.operation === 'events' ? { events, nextOffset: null } : undefined)
  return { id, owner, recording, events }
}
it('正式脚本生成、通用读写及撤销；不能解除阻断或扩大操作目标', async () => {
  const { id } = await fixture(), app = createApplicationHarness()
  try {
    const result = await app.requireResult('generate_screen_recording_script', { sessionRef: { kind: 'screen_recording.session', id } })
    expect(result).toMatchObject({ verified: true, blocked: 0, steps: 3 })
    const ref = { kind: 'screen_recording.understanding', id }, key = 'screen_recording.understanding.result'
    const before = recordingDocumentSchema.parse((await getPlatform().documents.readDocument({ id })).content).understanding, edited = structuredClone(before)
    edited.operationScript.steps[1].title = '新标题'
    const changed = await app.change(ref, { [key]: edited })
    expect(changed).toMatchObject({ ok: true })
    expect((await getPlatform().documents.readDocument({ id })).content).toMatchObject({ understanding: { operationScript: { steps: [expect.anything(), expect.objectContaining({ title: '新标题' }), expect.anything()] } } })
    if (!changed.ok) throw new Error('脚本写入失败')
    await app.requireResult('undo_application_changes', { undoRef: changed.data.undoRef })
    expect((await getPlatform().documents.readDocument({ id })).content).toMatchObject({ understanding: { operationScript: before.operationScript } })
    const malicious = structuredClone(edited.operationScript); malicious.steps[1].operations[0].target.id = 'real-project:real-clip'
    expect(() => assertRecordedScriptEdits(malicious, before.operationScript)).toThrow('更换目标')
  } finally { app.dispose() }
})
it('真实领域临时副本按脚本修改，原工程不变；失败清理且不推进下一步', async () => {
  const { id, owner } = await fixture(), app = createApplicationHarness(), original = structuredClone(owner.document)
  const invoked: string[] = []
  const invokeCapability = async (capability: string, input: unknown): Promise<Record<string, unknown>> => {
    const change = (input as { changes: Array<{ target: { id: string } }> }).changes[0]
    invoked.push(change.target.id)
    expect(change.target.id).not.toContain(owner.document.id)
    return app.requireResult(capability, input as Record<string, unknown>)
  }
  try {
    expect(await app.requireResult('replay_screen_recording_script', { sessionRef: { kind: 'screen_recording.session', id }, stepId: 'step1' })).toMatchObject({ completedSteps: ['step0', 'step1'], verified: true })
    expect(await replaySession(id, { stepId: 'step1' }, { signal: new AbortController().signal, invokeCapability })).toMatchObject({ completedSteps: ['step0', 'step1'], verified: true })
    expect(owner.document).toEqual(original)
    expect(invoked).toHaveLength(2)
    expect((await getPlatform().documents.listProjects()).some(v => v.name.startsWith('重放临时-'))).toBe(false)
    invoked.length = 0
    await expect(replaySession(id, {}, { signal: new AbortController().signal, invokeCapability: async (capability, input) => { if (invoked.length === 1) throw new Error('注入失败'); return invokeCapability(capability, input) } })).rejects.toThrow('步骤1')
    expect(owner.document).toEqual(original)
    expect((await getPlatform().documents.listProjects()).some(v => v.name.startsWith('重放临时-'))).toBe(false)
  } finally { app.dispose() }
})
it('跨步骤拆分原片，只替换第二步，旁白、其他序列不变，整批一次撤销', async () => {
  const { owner, recording } = await fixture(), id = owner.document.id
  editVideoProject(id, draft => { draft = structuredClone(draft);
    const screen = createVideoEditSequence('屏幕'), audio = createVideoEditSequence('旁白')
    screen.tracks = [{ id: 'video-track', name: '画面', kind: 'video', index: 0, enabled: true, locked: false, muted: false, solo: false }]
    audio.tracks = [{ id: 'audio-track', name: '旁白', kind: 'audio', index: 0, enabled: true, locked: false, muted: false, solo: false }]
    draft.media.push({ id: 'voice', kind: 'audio', path: resolve(sep, 'fixture', 'voice.wav'), name: '旁白', durationSeconds: 9, width: 0, height: 0 })
    draft.items.push({ id: 'voice-item', mediaId: 'voice', name: '旁白', kind: 'audio' })
    draft.sequences.push(screen, audio)
    audio.clips.push(makeVideoEditItemClip(draft, 'voice-item', audio.id, { frame: 0, duration: 270, track: 0 }))
    audio.captions = [{ id: 'spoken', start: 90, duration: 90, text: '第二步旁白' }]
    draft.media.push({ id: 'old', kind: 'video', path: recording.media[0].path, name: '旧画面', width: 1920, height: 1080, durationSeconds: 9 }, { id: 'new', kind: 'video', path: resolve(sep, 'fixture', 'new.mp4'), name: '新画面', width: 1920, height: 1080, durationSeconds: 2 })
    draft.items.push({ id: 'old-item', mediaId: 'old', name: '旧画面', kind: 'video' }, { id: 'new-item', mediaId: 'new', name: '新画面', kind: 'video' })
    screen.clips.push(makeVideoEditItemClip(draft, 'old-item', screen.id, { frame: 0, duration: 270, track: 0, sourceComponent: 'video' }))
    return draft
  })
  const before = structuredClone(owner.document), history = owner.past.length
  editVideoProject(id, draft => {
    const result = replaceRecordingSteps(draft, recording, [{ step: recording.understanding.operationScript.steps[1], media: draft.media.find(v => v.id === 'new')! }])
    expect(result.replaced).toBe(1)
    return videoEditDocumentSchema.parse(result.document)
  })
  expect(owner.past).toHaveLength(history + 1)
  expect(owner.document.sequences[2]).toEqual(before.sequences[2])
  expect(owner.document.sequences[1].clips.map(v => [v.itemId, v.start, v.duration])).toEqual([['old-item', 0, 90], ['new-item', 90, 90], ['old-item', 180, 90]])
  undoVideoEdit(id)
  expect(owner.document.sequences).toEqual(before.sequences)
})

it('脚本生成需要读取权限，重放不能扩大调用者的能力授权', async () => {
  const { id, owner } = await fixture(), original = structuredClone(owner.document)
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: crypto.randomUUID(), capabilityIds: ['generate_screen_recording_script', 'replay_screen_recording_script'], permissions: ['screen_recording:write', 'video_edit:write', 'documents:write'], allowWrites: true, allowDestructive: false }))
  const input = { sessionRef: { kind: 'screen_recording.session', id } }
  const denied = await session.execute({ id: 'generate_screen_recording_script', version: 1, input }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  expect(denied.ok).toBe(false)
  const limited = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: crypto.randomUUID(), capabilityIds: ['replay_screen_recording_script'], permissions: ['screen_recording:read', 'screen_recording:write', 'video_edit:write', 'documents:write'], allowWrites: true, allowDestructive: false }))
  const failed = await limited.execute({ id: 'replay_screen_recording_script', version: 1, input }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  expect(failed.ok).toBe(false)
  expect(JSON.stringify(failed)).toContain('PERMISSION_DENIED')
  expect(owner.document).toEqual(original)
  expect((await getPlatform().documents.listProjects()).some(v => v.name.startsWith('重放临时-'))).toBe(false)
})
