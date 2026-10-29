import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import { explanationBodyRef } from '@/core/creativeIntent/semanticIntentEdits'
// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits, failVideoEditSaves } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { appendVideoEditClip, getActiveVideoEditSequence, setVideoEditView, closeVideoEditProject, editVideoProject, updateVideoEditCreativeIntents } from '@/features/videoEdit/application/videoEditService'
import { startVideoMotion, stopVideoMotion, demonstrateVideoMotion, recordVideoMotionPresentation, videoMotionComposition, videoMotionState } from '@/features/videoEdit/application/videoEditMotionDraft'
import { getPlatform } from '@/platform/runtime'
import { optimizeMotionDraft } from '@/core/creativeIntent/candidates'

import { intentRef, registerCreativeIntentHost } from './creativeIntentHost'
import type { ApplicationRef } from '@/core/application-control'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from './applicationCapabilityService'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { motionDraftSchema } from '@/core/creativeIntent/contracts'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import * as layoutService from '@/features/imageEdit/v3/application/imageEditLayoutDraft'
import { imageLayoutDigest } from '@/features/imageEdit/v3/application/imageEditLayoutResources'
import { imageCreativeIntentProvider } from '@/features/imageEdit/v3/application/imageEditCreativeIntentReflection'
import { requireImageEditPersistenceOwnerV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'
import { createImageLayoutCandidates } from '@/core/imageEdit/v3/layoutCandidates'
import { explanationSessionSchema } from '@/core/creativeIntent/schema'
import { applicationTransactionFailureFactsSchema } from '@/core/application-control/applicationTransactionFailureFacts'
import { readVideoMotionGroup } from '@/features/videoEdit/application/videoEditMotionGroup'
import { removeSuperKeyframeTake } from '@/features/videoEdit/application/videoEditSuperKeyframes'
import { superKeyframeSessionId } from '@/core/creativeIntent/captureIntent'

vi.mock('@/features/videoEdit/application/videoEditMotionWorkerClient', () => ({ optimizeVideoEditMotionOffThread: vi.fn(async (input: Parameters<typeof optimizeMotionDraft>[0], signal: AbortSignal, pages?: AsyncIterable<Parameters<typeof optimizeMotionDraft>[0]['samples']>) => {
  const samples = [...input.samples]; if (pages) for await (const page of pages) samples.push(...page); signal.throwIfAborted()
  input = { ...input, samples }; return { result: optimizeMotionDraft(input), original: optimizeMotionDraft({ ...input, draft: { ...input.draft, fidelity: 1 }, intent: undefined, beatFrames: undefined }).candidates[0] }
}) }))
beforeEach(() => {
  installHarnessNativeStorage(); vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks()
  const files = new Map<string, Uint8Array>()
  vi.spyOn(getPlatform().system.paths, 'tempDir').mockResolvedValue(tmpdir())
  vi.spyOn(getPlatform().system.paths, 'join').mockImplementation(async (...parts) => join(...parts))
  vi.spyOn(getPlatform().system.fs, 'writeFile').mockImplementation(async (path, bytes) => { files.set(path, bytes) })
  vi.spyOn(getPlatform().system.fs, 'readFile').mockImplementation(async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path)! })
  vi.spyOn(getPlatform().system.fs, 'remove').mockImplementation(async path => { files.delete(path) })
  vi.spyOn(getPlatform().documents, 'importFile').mockImplementation(async request => { const path = join(tmpdir(), 'intent-materials', `${crypto.randomUUID()}.json`); files.set(path, files.get(request.sourcePath)!); return { path, copied: true } })
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
async function setup() {
  const owner = await createVideoEditTestProject(), id = owner.document.id
  appendVideoEditClip(id); setVideoEditView(id, { selection: getActiveVideoEditSequence(owner).clips[0].id, frame: 0 })
  await startVideoMotion(id, 'place')
  const present = (frame: number) => { setVideoEditView(id, { frame }); recordVideoMotionPresentation(owner, { sequenceId: owner.activeSequenceId, frame, revision: videoMotionComposition(owner)!.revision, at: performance.now() }) }
  present(0)
  const state = videoMotionState(owner)!
  demonstrateVideoMotion(id, { ...state.pose, position: [.2, .3] }, 'down'); present(0)
  demonstrateVideoMotion(id, { ...state.pose, position: [.8, .3] }, 'up'); present(60)
  await stopVideoMotion(id)
  const draftRef = intentRef({ kind: 'video_edit.document', id }, 'intent_draft', state.draft.id)
  return { owner, state, draftRef }
}
it('整组分页保留全部目标采样与时间；删除段落后正式读取不再返回该段样本', async () => {
  const { owner, state } = await setup(), app = createApplicationHarness()
  try {
    const page = await readVideoMotionGroup(owner.document.id, state.draft.id, 0, new AbortController().signal)
    const records = page.lines.map(line => JSON.parse(line))
    expect(records.find(record => record.kind === 'super-keyframes').units.position).toContain('画幅比例')
    expect(records.filter(record => record.kind === 'sample')).toHaveLength(state.recent.length)
    expect(records.find(record => record.kind === 'take').targetRefs).toEqual([state.draft.targets[0].ref])
    const take = state.draft.takes[0]
    await removeSuperKeyframeTake(owner.document.id, state.draft.id, take.id)
    const after = await readVideoMotionGroup(owner.document.id, state.draft.id, 0, new AbortController().signal)
    expect(after.lines.map(line => JSON.parse(line)).filter(record => record.kind === 'sample' && record.takeRef === take.id)).toHaveLength(0)
    expect(videoMotionState(owner)!.recent.some(sample => sample.takeRef === take.id)).toBe(false)
  } finally { app.dispose() }
})
it('外部发现最近整组并走同一读取能力，正文无需外发许可', async () => {
  const { owner, state } = await setup(), app = createApplicationHarness(), id = owner.document.id
  try {
    const first = recordingFixtureSession(), second = recordingFixtureSession()
    first.id = superKeyframeSessionId(state.draft.id); first.ownerRef.id = id; first.consent!.textUpload = true
    second.id = superKeyframeSessionId('newest'); second.ownerRef.id = id; second.createdAt = '2026-10-22T12:00:00.000Z'; second.consent!.textUpload = true
    updateVideoEditCreativeIntents(id, { ...owner.document.creativeIntents!, drafts: [...owner.document.creativeIntents!.drafts, { ...structuredClone(state.draft), id: 'newest' }], sessions: [second, first] })
    const listed = await app.requireResult('list_application_entities', { entityType: 'video_edit.intent_draft', limit: 10 })
    expect((listed.refs as ApplicationRef[])[0].id).toBe(`${id}:newest`)

    const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'external-super-keyframes' }))
    const input = { draftRef: intentRef({ kind: 'video_edit.document', id }, 'intent_draft', state.draft.id) }
    const invoke = () => session.execute({ id: 'read_video_edit_super_keyframes', version: 1, input }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
    const result = await invoke()
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (result.ok) expect((result.data.lines as string[]).join('\n')).toContain(state.recent[0].sampleId)
    const head = structuredClone(owner.document.creativeIntents!); head.sessions.find(value => value.id === first.id)!.consent!.textUpload = false
    updateVideoEditCreativeIntents(id, head)
    expect((await invoke()).ok).toBe(true)
  } finally { app.dispose() }
})
it('AI 给定多目标、多属性曲线走一次正式通用事务，一步作品撤销恢复整组', async () => {
  const { owner } = await setup(), app = createApplicationHarness(), id = owner.document.id
  try {
    appendVideoEditClip(id)
    const clips = getActiveVideoEditSequence(owner).clips, before = structuredClone(clips), history = owner.past.length
    const baseline = await app.read({ kind: 'video_edit.document', id })
    const curves = [{ time: 0, value: 0, interpolation: 'linear' }, { time: 20, value: .3, interpolation: 'ease' }]
    await app.requireResult('change_application_entities', { summary: '应用整组超级关键帧', changes: clips.map(clip => ({ kind: 'set_properties', entityType: 'video_edit.clip', target: { kind: 'video_edit.clip', id: `${id}:${clip.id}` }, properties: { 'video_edit.clip.x.keyframes': curves, 'video_edit.clip.rotation.keyframes': [{ time: 0, value: 0, interpolation: 'linear' }, { time: 20, value: 90, interpolation: 'linear' }] } })) }, baseline.revisions as Record<string, number>)
    expect(owner.past.length).toBe(history + 1)
    expect(getActiveVideoEditSequence(owner).clips.every(clip => clip.curves?.x?.[1].value === .3)).toBe(true)
    await app.requireResult('undo_video_edit', { documentRef: { kind: 'video_edit.document', id } })
    expect(getActiveVideoEditSequence(owner).clips).toEqual(before)
  } finally { app.dispose() }
})
it('整理候选回执必须回读真实资源，文件丢失不能返回已核对', async () => {
  const { draftRef } = await setup(), app = createApplicationHarness()
  const read = vi.mocked(getPlatform().system.fs.readFile).getMockImplementation()!
  vi.mocked(getPlatform().system.fs.readFile).mockImplementation(async (...args) => {
    const bytes = await read(...args)
    if (new TextDecoder().decode(bytes).includes('"motions":')) throw new Error('候选文件已丢失')
    return bytes
  })
  try {
    const result = await app.call('organize_video_edit_intent', { draftRef })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain('候选文件已丢失')
  } finally { app.dispose() }
})

it('正式 describe → change/invoke → read：钉点保持、候选应用与一次作品撤销', async () => {
  const { owner, state, draftRef } = await setup(), app = createApplicationHarness()
  try {
    const description = await app.requireResult('describe_application_entities', { entityTypes: [draftRef.kind] })
    expect(JSON.stringify(description)).toContain('fidelity')
    expect((await app.change(draftRef, { 'video_edit.intent_draft.label': '保留原节奏' })).ok).toBe(true)
    expect((await app.read(draftRef, ['video_edit.intent_draft.label'])).properties).toMatchObject({ 'video_edit.intent_draft.label': '保留原节奏' })
    const pin = await app.requireResult('change_application_entities', { summary: '钉住终点', changes: [{ kind: 'create_items', entityType: 'video_edit.intent_pin', parent: draftRef, items: [{ properties: { 'video_edit.intent_pin.sample_id': state.recent.at(-1)!.sampleId } }] }] })
    expect((pin.resultRefs as ApplicationRef[]).length).toBe(1)
    const pins = structuredClone(owner.document.creativeIntents!.drafts[0].pins)
    const duplicate = await app.call('change_application_entities', { summary: '验证部分钉点修改回滚', changes: [{ kind: 'create_items', entityType: 'video_edit.intent_pin', parent: draftRef, items: [state.recent[0], state.recent.at(-1)!].map(sample => ({ properties: { 'video_edit.intent_pin.sample_id': sample.sampleId } })) }] })
    expect(duplicate.ok).toBe(false)
    expect(owner.document.creativeIntents!.drafts[0].pins).toEqual(pins)
    const baseline = await app.read(draftRef)
    const organized = await app.requireResult('organize_video_edit_intent', { draftRef, motionIntent: { kind: 'follow_path', preserveJitter: false }, takeIds: [state.draft.takes[0].id] }, baseline.revisions as Record<string, number>)
    expect(organized.verification).toMatchObject({ verified: true })
    expect(videoMotionState(owner)!.intent).toEqual({ kind: 'follow_path', preserveJitter: false })
    expect(owner.document.creativeIntents!.drafts[0].pins).toEqual(pins)
    const candidate = (organized.candidateRefs as ApplicationRef[])[0]; expect(candidate).toBeDefined()
    const readback = await app.read(candidate, ['video_edit.intent_candidate.details'])
    expect(readback.properties).toMatchObject({ 'video_edit.intent_candidate.details': { proposal: { label: expect.any(String), motions: expect.any(Array) } } })
    const before = structuredClone(getActiveVideoEditSequence(owner).clips[0].curves), history = owner.past.length
    const result = await app.change(candidate, { 'video_edit.intent_candidate.applied': true })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(getActiveVideoEditSequence(owner).clips[0].curves).not.toEqual(before)
    expect(owner.past.length).toBe(history + 1)
    expect((await app.read(candidate, ['video_edit.intent_candidate.applied'])).properties).toMatchObject({ 'video_edit.intent_candidate.applied': true })
    await app.requireResult('undo_video_edit', { documentRef: { kind: 'video_edit.document', id: owner.document.id } })
    expect(getActiveVideoEditSequence(owner).clips[0].curves).toEqual(before)
  } finally { app.dispose() }
})
it('原稿元数据经公共事务回执一次撤销，跨连接不可借用回执', async () => {
  const { owner, draftRef } = await setup(), app = createApplicationHarness(), other = createApplicationHarness()
  try {
    const label = owner.document.creativeIntents!.drafts[0].label
    const result = await app.change(draftRef, { 'video_edit.intent_draft.label': '可撤销名称' })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) throw new Error('change failed')
    expect(result.data.undoRef).toBeTypeOf('string')
    const denied = await other.call('undo_application_changes', { undoRef: result.data.undoRef })
    expect(denied.ok).toBe(false)
    await app.requireResult('undo_application_changes', { undoRef: result.data.undoRef })
    expect(owner.document.creativeIntents!.drafts[0].label).toBe(label)
    expect((await app.call('undo_application_changes', { undoRef: result.data.undoRef })).ok).toBe(false)
  } finally { app.dispose(); other.dispose() }
})
it('原稿集合复用真实证据、删除和公共撤销，不复活旧宿主缓存', async () => {
  const { owner, draftRef } = await setup(), app = createApplicationHarness(), documentRef = { kind: 'video_edit.document', id: owner.document.id }
  try {
    const created = await app.requireResult('change_application_entities', { summary: '复用原稿', changes: [{ kind: 'create_items', entityType: draftRef.kind, parent: documentRef,
      items: [{ properties: { 'video_edit.intent_draft.source_ref': draftRef, 'video_edit.intent_draft.label': '副本' } }] }] })
    const copy = (created.resultRefs as ApplicationRef[])[0]
    expect(owner.document.creativeIntents!.drafts).toHaveLength(2)
    expect(owner.document.creativeIntents!.drafts[1].takes).toEqual(owner.document.creativeIntents!.drafts[0].takes)
    const baseline = await app.read(copy)
    const removed = await app.requireResult('change_application_entities', { summary: '删除副本', changes: [{ kind: 'remove_items', entityType: draftRef.kind, parent: documentRef, targets: [copy] }] }, baseline.revisions as Record<string, number>)
    expect(owner.document.creativeIntents!.drafts).toHaveLength(1)
    await app.requireResult('undo_application_changes', { undoRef: removed.undoRef })
    expect(owner.document.creativeIntents!.drafts).toHaveLength(2)
    const take = owner.document.creativeIntents!.drafts[1].takes[0]
    const takeRef = { kind: 'video_edit.intent_take', id: `${copy.id}:${encodeURIComponent(take.id)}` }
    const takeBaseline = await app.read(takeRef)
    const deleted = await app.requireResult('change_application_entities', { summary: '移除示范', changes: [{ kind: 'remove_items', entityType: takeRef.kind, parent: copy, targets: [takeRef] }] }, takeBaseline.revisions as Record<string, number>)
    expect(owner.document.creativeIntents!.drafts[1].takes.some(t => t.id === take.id)).toBe(false)
    await app.requireResult('undo_application_changes', { undoRef: deleted.undoRef })
    expect(owner.document.creativeIntents!.drafts[1].takes.some(t => t.id === take.id)).toBe(true)
  } finally { app.dispose() }
})
it('权限拒绝先于 provider；已关闭实例不写入；保存失败只恢复保存', async () => {
  const { owner, draftRef } = await setup(), app = createApplicationHarness()
  try {
    await expect(app.read({ ...draftRef, id: `${draftRef.id}:extra` })).rejects.toThrow('引用无效')
    failVideoEditSaves(true)
    const failed = await app.change(draftRef, { 'video_edit.intent_draft.label': '保存待恢复' })
    expect(failed.ok).toBe(false); expect(owner.document.creativeIntents!.drafts[0].label).toBe('保存待恢复')
    failVideoEditSaves(false)
    expect((await app.call('save_video_edit', { documentRef: { kind: 'video_edit.document', id: owner.document.id } })).ok).toBe(true)
    await closeVideoEditProject(owner.document.id)
    expect((await app.call('organize_video_edit_intent', { draftRef })).ok).toBe(false)
  } finally { failVideoEditSaves(false); app.dispose() }
})
it('正式候选应用保存失败后恢复回执，不重复写曲线或增加撤销步', async () => {
  const { owner, draftRef } = await setup(), app = createApplicationHarness()
  try {
    const organized = await app.requireResult('organize_video_edit_intent', { draftRef })
    const candidate = (organized.candidateRefs as ApplicationRef[])[0], history = owner.past.length
    failVideoEditSaves(true)
    const failed = await app.change(candidate, { 'video_edit.intent_candidate.applied': true })
    expect(failed.ok).toBe(false)
    expect(owner.past.length).toBe(history + 1)
    expect(owner.document.creativeIntents!.drafts[0].applications).toMatchObject([{ saved: false }])
    const curves = structuredClone(getActiveVideoEditSequence(owner).clips[0].curves)
    failVideoEditSaves(false)
    const recovered = await app.change(candidate, { 'video_edit.intent_candidate.saved': true })
    expect(recovered.ok, JSON.stringify(recovered)).toBe(true)
    expect(owner.document.creativeIntents!.drafts[0].applications).toMatchObject([{ saved: true }])
    expect(owner.past.length).toBe(history + 1)
    expect(getActiveVideoEditSequence(owner).clips[0].curves).toEqual(curves)
  } finally { failVideoEditSaves(false); app.dispose() }
})
it('作品后续手调后，正式候选应用拒绝过期结果并保留新状态', async () => {
  const { owner, draftRef } = await setup(), app = createApplicationHarness()
  try {
    const organized = await app.requireResult('organize_video_edit_intent', { draftRef })
    const candidate = (organized.candidateRefs as ApplicationRef[])[0]
    editVideoProject(owner.document.id, document => { document = structuredClone(document); document.sequences[0].clips[0].x = .25; return document })
    const history = owner.past.length
    const rejected = await app.change(candidate, { 'video_edit.intent_candidate.applied': true })
    expect(rejected.ok).toBe(false)
    expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(.25)
    expect(owner.past.length).toBe(history)
    expect(owner.document.creativeIntents!.drafts[0].applications).toHaveLength(0)
  } finally { app.dispose() }
})
it('图片正式原稿名称可读写保存；损坏原稿拒绝整理并保持作品', async () => {
  const document = createImageEditDocumentV3({ documentId: 'intent-image-public', width: 8, height: 8 })
  const draft = motionDraftSchema.parse({ id: 'draft', version: 1, ownerRef: { kind: 'image_edit.document', id: `v3:${document.id}` }, mode: 'static', label: '随手摆', fidelity: .5, sourceDigest: `sha256:${'a'.repeat(64)}`, targets: [], takes: [], pins: [], clockSegments: [], constraints: [], recipeRefs: [], candidateRefs: [], applications: [] })
  document.creativeIntents = { drafts: [draft], sessions: [], resources: [] }
  const bus = new ImageEditCommandBusV3(document), dispose = registerPersistedImageEditTestSession('intent-image-public', bus, new ImageEditorV3CommandRepository()), app = createApplicationHarness()
  const ref = intentRef(draft.ownerRef, 'intent_draft', draft.id)
  try {
    const result = await app.change(ref, { 'image_edit.intent_draft.label': '图片原稿' })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect((await app.read(ref, ['image_edit.intent_draft.label'])).properties).toMatchObject({ 'image_edit.intent_draft.label': '图片原稿' })
    const blocked = await app.change(ref, { 'image_edit.intent_draft.fidelity': .7 })
    expect(blocked.ok).toBe(false); expect(JSON.stringify(blocked)).toContain('原稿')
    expect(bus.getSnapshot().document.creativeIntents!.drafts[0].fidelity).toBe(.5)
    expect(bus.undo()).toBe(true); expect(bus.getSnapshot().document.creativeIntents!.drafts[0].label).toBe('随手摆')
  } finally { app.dispose(); dispose() }
})
it('正式 C2 讲解读取与封闭计划：未授权拒绝、连续输入回执、错误计划回退和撤权', async () => {
  const { owner, draftRef } = await setup(), documentRef = { kind: 'video_edit.document', id: owner.document.id }
  const session = explanationSessionSchema.parse({ id: 'private-recording', version: 1, ownerRef: { kind: 'document.video_edit', id: owner.document.id }, createdAt: new Date().toISOString(), state: 'reviewing', mode: 'animated',
    sourceDigest: `sha256:${'a'.repeat(64)}`, retentionStatus: 'absent', clockSegments: [], pages: [], visualEvidenceRefs: [], bindings: [], segmentExclusions: [], corrections: [], annotationRefs: [], appliedReceiptRefs: [], finalPoseRefs: [],
    consent: { noticeDigest: `sha256:${'b'.repeat(64)}`, userReceiptRef: 'user-consent', capture: true, keepAudio: false, audioUpload: false, textUpload: false, imageUpload: false } })
  updateVideoEditCreativeIntents(owner.document.id, { ...owner.document.creativeIntents!, sessions: [session] })
  const raw = { documentRef, sessionId: session.id, offset: 0, imageOffset: 0 }
  session.consent!.textUpload = true
  updateVideoEditCreativeIntents(owner.document.id, { ...owner.document.creativeIntents!, sessions: [session] })
  const createSession = (_capabilityId: string, _input: unknown) => createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'private-caller' }))
  const read = createSession('read_video_edit_intent_recording', raw)
  const result = await read.execute({ id: 'read_video_edit_intent_recording', version: 1, input: raw }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) throw new Error('private read failed')
  expect(result.data.inputReceipt).toBeTypeOf('string')
  expect(result.data.semanticImages).toEqual([])
  expect(JSON.stringify(result.data)).not.toContain('input_audio')
  const proposed = { draftRef, sessionId: session.id, inputReceipt: result.data.inputReceipt, semanticPlan: { draftDigest: `sha256:${'f'.repeat(64)}`, actions: [], protectedRefs: [], questions: [] } }
  const interpreted = await createSession('interpret_video_edit_intent', proposed).execute({ id: 'interpret_video_edit_intent', version: 1, input: proposed }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  expect(interpreted.ok, JSON.stringify(interpreted)).toBe(true)
  if (interpreted.ok) expect(interpreted.data.status).toBe('local_fallback')
  const replay = await createSession('interpret_video_edit_intent', proposed).execute({ id: 'interpret_video_edit_intent', version: 1, input: proposed }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  expect(replay.ok).toBe(false)
  session.consent!.textUpload = false
  updateVideoEditCreativeIntents(owner.document.id, { ...owner.document.creativeIntents!, sessions: [session] })
  expect((await read.execute({ id: 'read_video_edit_intent_recording', version: 1, input: raw }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })).ok).toBe(true)
})
it('图片正式保真度、钉点、应用保存失败恢复和公共撤销共用原布局服务，无事务互等', async () => {
  const document = createImageEditDocumentV3({ documentId: 'image-intent-transaction', width: 1000, height: 600 })
  document.layers = ['a', 'b', 'c'].map((id, i) => ({ ...createImageEditRasterLayerV3(id, id), transform: [1, 0, 0, 1, i * 150, i * 13] }))
  const bus = new ImageEditCommandBusV3(document), values = new Map<string, unknown>()
  let fail = false
  const save = vi.fn(async (value: typeof document) => { if (fail) throw new Error('disk unavailable'); return { documentId: value.id, revision: value.revision, previewRef: null } })
  const dispose = registerPersistedImageEditTestSession('image-intent-transaction', bus, { save })
  const owner = requireImageEditPersistenceOwnerV3(document.id)
  const adapter = new layoutService.ImageEditLayoutDraft(bus, { measure: async () => [[0, 0], [50, 0], [50, 30], [0, 30]],
    compute: async input => createImageLayoutCandidates(input.items, input.constraints, input.identity, input.fidelity),
    confirm: () => owner.confirm(), confirmStep: async (context, settled) => { owner.acceptCurrent(); await owner.confirmStep(context, settled) }, release: async () => undefined,
    store: async (value, kind) => { const digest = await imageLayoutDigest(value); values.set(digest, value); return { resourceId: digest, digest, kind, path: `resources/${digest.slice(7)}`, bytes: new TextEncoder().encode(JSON.stringify(value)).length,
      ...(value && typeof value === 'object' && 'sourceDigest' in value ? { sourceDigest: String(value.sourceDigest) } : {}) } }, read: async resource => values.get(resource.resourceId) })
  vi.spyOn(layoutService, 'imageEditLayoutDraft').mockReturnValue(adapter)
  const app = createApplicationHarness()
  registerCreativeIntentHost({ ...imageCreativeIntentProvider, readResource: async resource => values.get(resource.resourceId) })
  try {
    await adapter.organize(['a', 'b', 'c'])
    const draft = adapter.snapshot().draft!, draftRef = intentRef(draft.ownerRef, 'intent_draft', draft.id)
    expect((await app.change(draftRef, { 'image_edit.intent_draft.fidelity': .2 })).ok).toBe(true)
    const pinned = await app.requireResult('change_application_entities', { summary: '钉住图片位置', changes: [{ kind: 'create_items', entityType: 'image_edit.intent_pin', parent: draftRef,
      items: [{ properties: { 'image_edit.intent_pin.sample_id': adapter.snapshot().entries[0].sample.sampleId } }] }] })
    expect(bus.getSnapshot().document.creativeIntents!.drafts[0].pins).toHaveLength(1)
    await app.requireResult('undo_application_changes', { undoRef: pinned.undoRef })
    const current = bus.getSnapshot().document.creativeIntents!.drafts[0], candidateRef = intentRef(draft.ownerRef, 'intent_candidate', draft.id, current.candidateRefs[0].resourceId)
    const before = structuredClone(bus.getSnapshot().document.layers), history = bus.getHistoryView().position
    fail = true
    const failed = await app.change(candidateRef, { 'image_edit.intent_candidate.applied': true })
    expect(failed.ok).toBe(false)
    if (failed.ok) throw new Error('Expected controlled save failure')
    const failedReceipt = applicationTransactionFailureFactsSchema.parse(failed.error.details?.transaction)
    expect(failedReceipt.undoRef).toBeTypeOf('string')
    expect(bus.getSnapshot().document.creativeIntents!.drafts[0].applications).toHaveLength(1)
    expect(bus.getHistoryView().position).toBe(history + 1)
    const after = structuredClone(bus.getSnapshot().document.layers)
    fail = false
    const recovered = await app.change(candidateRef, { 'image_edit.intent_candidate.saved': true })
    expect(recovered.ok, JSON.stringify(recovered)).toBe(true)
    expect(bus.getSnapshot().document.layers).toEqual(after)
    expect(bus.getHistoryView().position).toBe(history + 1)
    expect((await app.read(candidateRef, ['image_edit.intent_candidate.saved'])).properties).toMatchObject({ 'image_edit.intent_candidate.saved': true })
    await app.requireResult('undo_application_changes', { undoRef: failedReceipt.undoRef })
    expect(bus.getSnapshot().document.layers).toEqual(before)
  } finally { fail = false; registerCreativeIntentHost(imageCreativeIntentProvider); app.dispose(); dispose() }
})

it.each(['video_edit', 'image_edit'] as const)('%s 冷宿主通过公共 C2 正文事务编辑并用真实公共回执一步撤销', async domain => {
  const video = domain === 'video_edit' ? await createVideoEditTestProject() : undefined
  const document = createImageEditDocumentV3({ documentId: 'cold-private-image', width: 100, height: 100 })
  const bus = new ImageEditCommandBusV3(document)
  const dispose = domain === 'image_edit' ? registerPersistedImageEditTestSession('cold-private-image', bus) : () => {}
  const documentRef = { kind: `${domain}.document`, id: video?.document.id ?? `v3:${document.id}` }
  const session = recordingFixtureSession(domain === 'image_edit' ? 'static' : 'animated'); session.state = 'reviewing'
  session.ownerRef = domain === 'image_edit' ? documentRef : { kind: 'document.video_edit', id: documentRef.id }
  session.consent!.textUpload = true
  session.bindings = [{ id: 'binding', utteranceIds: ['u'], wordIds: [], targetRefs: [], point: [.5, .5], evidenceSeqs: [], timelineSpans: [], confidence: 'confirmed', correctedByUser: true }]
  const originalBindings = structuredClone(session.bindings)
  const head = { drafts: [], sessions: [session], resources: [] }
  if (video) updateVideoEditCreativeIntents(video.document.id, head)
  else bus.dispatch({ type: 'document.set-creative-intents', commandId: 'cold-head', expectedRevision: 0, intents: head, resources: [] })
  const ref = explanationBodyRef(documentRef, session.id)
  const invoke = async (id: string, input: unknown) => {
    const caller = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'cold-editor' }))
    const definition = caller.list().find(capability => capability.id === id)
    if (!definition) throw new Error('能力未授权')
    return caller.execute({ id, version: definition.version, input }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  }
  try {
    const changed = await invoke('change_application_entities', { summary: '清除讲解指向', changes: [{ kind: 'set_properties', target: ref, entityType: ref.kind, properties: { [`${domain}.explanation_body.bindings`]: [] } }] })
    expect(changed.ok, JSON.stringify(changed)).toBe(true)
    if (!changed.ok) throw new Error('change failed')
    const read = () => (video?.document ?? bus.getSnapshot().document).creativeIntents!.sessions[0]
    expect(read().bindings).toEqual([])
    const undone = await invoke('undo_application_changes', { undoRef: changed.data.undoRef })
    expect(undone.ok, JSON.stringify(undone)).toBe(true)
    expect(read().bindings).toEqual(originalBindings)
  } finally { dispose(); bus.dispose() }
})
