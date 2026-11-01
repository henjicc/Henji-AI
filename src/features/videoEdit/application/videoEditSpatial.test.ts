// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { videoEditComposition } from '@/core/videoEdit/document'
import { evaluateSpatialFrame } from '@/core/videoEdit/spatialEvaluation'
import { planSpatialLayout } from '@/core/videoEdit/spatialLayout'
import { planSpatialPropagation } from '@/core/videoEdit/spatialPropagation'
import { SPATIAL_KEYS } from '@/core/videoEdit/spatialSchema'
import { videoEditClipValue } from '@/core/videoEdit/keyframes'
import { arrangeVideoEditDepthCapability, verifyVideoEditSpaceCapability } from '@/core/application-control/domains/videoEdit/videoEditSpatialCapabilities'
import { createLegacyTrackVideoEditProject, reopenVideoEdit, savedVideoEdit, failVideoEditSaves } from './videoEditDocumentTestKit'
import { appendVideoEditClip, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, saveVideoEdit } from './videoEditService'
import { videoEditSpatialOutput, videoEditStoredSpatialCamera } from './videoEditSpatial'

// 仅替换线程投递与像素边界；数学、声明、事务、存储和正式读回均运行真实实现。
vi.mock('./videoEditMotionWorkerClient', async importOriginal => ({ ...await importOriginal<typeof import('./videoEditMotionWorkerClient')>(), planVideoEditSpatialLayoutOffThread: (...args: Parameters<typeof planSpatialLayout>) => planSpatialLayout(...args), planVideoEditSpatialPropagationOffThread: (...args: Parameters<typeof planSpatialPropagation>) => planSpatialPropagation(...args) }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks(): void {} setSmartRegions(): void {}
  async updateDocument(): Promise<void> {}
  async present(): Promise<{ presented: boolean }> { return { presented: true } }
  async dispose(): Promise<void> {}
} }))

beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { failVideoEditSaves(false); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createLegacyTrackVideoEditProject(), id = owner.document.id
  for (let index = 0; index < 3; index++) appendVideoEditClip(id)
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, motionBlur: false, clips: sequence.clips.map((clip, index) => ({ ...clip, track: index + 1, start: 0, duration: 90, x: (index - 1) * .27, y: 0, scale: .2 })) })) }))
  await saveVideoEdit(id)
  const sequence = getActiveVideoEditSequence(owner), documentRef = { kind: 'video_edit.document' as const, id }, sequenceRef = { kind: 'video_edit.sequence' as const, id: `${id}:${sequence.id}` }
  const clipRefs = sequence.clips.map(clip => ({ kind: 'video_edit.clip' as const, id: `${id}:${clip.id}` }))
  const app = createApplicationHarness()
  return { owner, id, app, documentRef, sequenceRef, clipRefs, focusRef: clipRefs[1], sequenceId: sequence.id }
}

it('公共通用字段保存取景意图、空间关键帧；重新打开仍跟随目标而非保存绝对机位', async () => {
  const f = await fixture()
  try {
    const changed = await f.app.change(f.focusRef, { 'video_edit.clip.spatial_enabled': true, 'video_edit.clip.depth': .2, 'video_edit.clip.rotation_x.keyframes': [{ time: 0, value: 0, interpolation: 'ease' }, { time: 60, value: 8, interpolation: 'linear' }] })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    const camera = { framing: { target: { kind: 'clip', targetRef: f.focusRef }, heightFraction: .25, perspective: .5 }, focus: { kind: 'clip', targetRef: f.focusRef }, defocus: .4 }
    expect(await f.app.change(f.sequenceRef, { 'video_edit.sequence.spatial_camera': camera })).toMatchObject({ ok: true })
    const stored = savedVideoEdit(f.id).sequences[0].spatialCamera!
    expect(stored.framing).toEqual({ target: { kind: 'clip', clipId: f.focusRef.id.split(':')[1] }, heightFraction: .25 })
    expect(stored.perspective).toBe(.5); expect(stored).not.toHaveProperty('position'); expect(stored).not.toHaveProperty('focalLengthMm')
    const reopened = await reopenVideoEdit(f.id)
    expect(reopened.document.sequences[0].spatialCamera).toEqual(stored)
    expect((await f.app.read(f.sequenceRef, ['video_edit.sequence.spatial_camera'])).properties).toMatchObject({ 'video_edit.sequence.spatial_camera': { framing: { target: { targetRef: f.focusRef } } } })
    const before = evaluateSpatialFrame(videoEditComposition(reopened.document, f.sequenceId), 0, videoEditSpatialOutput(reopened.document.sequences[0]), 'final')
    expect(await f.app.change(f.focusRef, { 'video_edit.clip.scale': .3 })).toMatchObject({ ok: true })
    const after = evaluateSpatialFrame(videoEditComposition(reopened.document, f.sequenceId), 0, videoEditSpatialOutput(reopened.document.sequences[0]), 'final')
    expect(after.camera.position[2]).not.toBe(before.camera.position[2])
  } finally { f.app.dispose() }
})
it('两项算法经正式调用、结构验证、同栈撤销与保存重开；游标拒绝变更后的内容', async () => {
  const f = await fixture()
  try {
    const input = { documentRef: f.documentRef, sequenceRef: f.sequenceRef, clipRefs: f.clipRefs, focusRef: f.focusRef }
    const original = structuredClone(f.owner.document.sequences[0]), history = f.owner.past.length
    const arranged = await f.app.requireResult('arrange_video_edit_depth', { ...input, referenceFrame: 10, parallaxRatio: 1.5 })
    expect(arrangeVideoEditDepthCapability.outputSchema.parse(arranged)).toMatchObject({ saved: true, achievedParallaxRatio: expect.closeTo(1.5, 7), verification: { verified: true } })
    expect(f.owner.past).toHaveLength(history + 1)
    const request = { documentRef: f.documentRef, sequenceRef: f.sequenceRef, frames: Array.from({ length: 20 }, (_, frame) => frame) }
    const page = verifyVideoEditSpaceCapability.outputSchema.parse(await f.app.requireResult('verify_video_edit_space', request))
    expect(page.verificationKind).toBe('structural'); expect(page.nextCursor).not.toBeNull()
    expect(page.records.some(record => record.kind === 'card' && record.approximation === 'layer-center')).toBe(true)
    expect(arranged.undoRef).toEqual(f.documentRef)
    await f.app.requireResult('undo_video_edit', { documentRef: arranged.undoRef })
    expect(f.owner.document.sequences[0]).toEqual(original)
    expect(await f.app.call('verify_video_edit_space', { ...request, cursor: page.nextCursor })).toMatchObject({ ok: false })
    const expanded = await f.app.requireResult('transition_video_edit_space', { ...input, mode: 'expand', range: [10, 30], parallaxRatio: 1.5, perspective: .5 })
    expect(expanded).toMatchObject({ saved: true })
    const flat = await f.app.requireResult('transition_video_edit_space', { ...input, mode: 'flatten', range: [10, 30] })
    expect(flat).toMatchObject({ saved: true })
    const reopened = await reopenVideoEdit(f.id), base = videoEditComposition(reopened.document, f.sequenceId)
    expect(evaluateSpatialFrame(base, 30, videoEditSpatialOutput(reopened.document.sequences[0]), 'final').flatIdentity).toBe(true)
    for (const clip of base.clips) for (const key of SPATIAL_KEYS) expect(videoEditClipValue(clip, key, 30)).toBe(0)
  } finally { f.app.dispose() }
})
it('非法跨序列目标与旧并发基线拒绝且不写入；保存失败只重试落盘', async () => {
  const f = await fixture()
  try {
    const input = { documentRef: f.documentRef, sequenceRef: f.sequenceRef, clipRefs: f.clipRefs, focusRef: f.focusRef, referenceFrame: 10, parallaxRatio: 1.5 }
    const baseline = await f.app.read(f.sequenceRef), before = structuredClone(f.owner.document)
    expect(await f.app.call('arrange_video_edit_depth', { ...input, focusRef: { ...f.focusRef, id: 'another:missing' } })).toMatchObject({ ok: false })
    expect(f.owner.document).toEqual(before)
    expect(await f.app.change(f.clipRefs[0], { 'video_edit.clip.x': -.2 })).toMatchObject({ ok: true })
    const history = f.owner.past.length
    expect(await f.app.call('arrange_video_edit_depth', input, baseline.revisions as Record<string, number>)).toMatchObject({ ok: false })
    expect(f.owner.past).toHaveLength(history)
    failVideoEditSaves(true)
    expect(await f.app.call('arrange_video_edit_depth', input)).toMatchObject({ ok: false })
    expect(f.owner.past).toHaveLength(history + 1)
    const applied = structuredClone(f.owner.document.sequences[0]); failVideoEditSaves(false)
    await f.app.requireResult('save_video_edit', { documentRef: f.documentRef })
    expect(f.owner.document.sequences[0]).toEqual(applied); expect(f.owner.past).toHaveLength(history + 1)
  } finally { f.app.dispose() }
})
it('精确光学写入由同一转换服务保存为透视量，非方形像素只应用一次', async () => {
  const f = await fixture()
  try {
    const camera = await videoEditStoredSpatialCamera(f.owner.document, f.sequenceId, { optics: { focalLengthMm: 160 } })
    expect(camera?.perspective).toBe(1)
    expect(await f.app.change(f.sequenceRef, { 'video_edit.sequence.spatial_camera': { optics: { focalLengthMm: 160 } } })).toMatchObject({ ok: true })
    expect(savedVideoEdit(f.id).sequences[0].spatialCamera).toEqual({ perspective: 1 })
    const sequence = { ...f.owner.document.sequences[0], width: 1440, pixelAspectRatio: { numerator: 4, denominator: 3 } }
    const composition = { ...videoEditComposition(f.owner.document, f.sequenceId), ...sequence, width: 1920, sequences: [sequence] }
    expect(videoEditSpatialOutput(composition)).toEqual({ width: 1440, height: 1080, displayWidth: 1920, displayHeight: 1080 })
  } finally { f.app.dispose() }
})
