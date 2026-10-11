// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits, failVideoEditSaves } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { appendVideoEditClip, getActiveVideoEditSequence, setVideoEditView, closeVideoEditProject, editVideoProject } from '@/features/videoEdit/application/videoEditService'
import { startVideoMotion, stopVideoMotion, demonstrateVideoMotion, recordVideoMotionPresentation, videoMotionComposition, videoMotionState } from '@/features/videoEdit/application/videoEditMotionDraft'
import { getPlatform } from '@/platform/runtime'
import { optimizeMotionDraft } from '@/core/creativeIntent/candidates'
import { optimizeVideoEditMotionOffThread } from '@/features/videoEdit/application/videoEditMotionWorkerClient'
import { intentRef } from './creativeIntentHost'
import type { ApplicationRef } from '@/core/application-control'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from './applicationCapabilityService'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { motionDraftSchema } from '@/core/creativeIntent/contracts'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'

vi.mock('@/features/videoEdit/application/videoEditMotionWorkerClient', () => ({ optimizeVideoEditMotionOffThread: vi.fn(async (input: Parameters<typeof optimizeMotionDraft>[0], signal: AbortSignal, pages?: AsyncIterable<Parameters<typeof optimizeMotionDraft>[0]['samples']>) => {
  const samples = [...input.samples]; if (pages) for await (const page of pages) samples.push(...page); signal.throwIfAborted()
  input = { ...input, samples }; return { result: optimizeMotionDraft(input), original: optimizeMotionDraft({ ...input, draft: { ...input.draft, fidelity: 1 }, intent: undefined }).candidates[0] }
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
    const organized = await app.requireResult('organize_video_edit_intent', { draftRef }, baseline.revisions as Record<string, number>)
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
it('权限拒绝先于 provider；已关闭实例不写入；保存失败只恢复保存', async () => {
  const { owner, draftRef } = await setup(), app = createApplicationHarness()
  try {
    await expect(app.read({ ...draftRef, id: `${draftRef.id}:extra` })).rejects.toThrow('引用无效')
    const denied = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'denied', capabilityIds: ['organize_video_edit_intent'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false }))
    await expect(denied.execute({ id: 'organize_video_edit_intent', version: 1, input: { draftRef } }, { requestId: 'denied', signal: new AbortController().signal })).rejects.toThrow('PERMISSION_DENIED')
    expect(optimizeVideoEditMotionOffThread).not.toHaveBeenCalled()
    expect(owner.document.creativeIntents!.drafts[0].candidateRefs).toHaveLength(0)
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
    editVideoProject(owner.document.id, document => { document.sequences[0].clips[0].x = .25; return document })
    const history = owner.past.length
    const rejected = await app.change(candidate, { 'video_edit.intent_candidate.applied': true })
    expect(rejected.ok).toBe(false)
    expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(.25)
    expect(owner.past.length).toBe(history)
    expect(owner.document.creativeIntents!.drafts[0].applications).toHaveLength(0)
  } finally { app.dispose() }
})
it('图片正式原稿名称可读写保存；未接通的批量保存动作在 describe 阶段明确拒绝', async () => {
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
    expect(blocked.ok).toBe(false); expect(JSON.stringify(blocked)).toContain('保存')
    expect(bus.getSnapshot().document.creativeIntents!.drafts[0].fidelity).toBe(.5)
    expect(bus.undo()).toBe(true); expect(bus.getSnapshot().document.creativeIntents!.drafts[0].label).toBe('随手摆')
  } finally { app.dispose(); dispose() }
})
