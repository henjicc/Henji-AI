// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { closeAllVideoEdits, savedVideoEdit } from './videoEditDocumentTestKit'
import { createVideoEditProject, editVideoProject, undoVideoEdit } from './videoEditService'
import { nestVideoEditSelection, openVideoEditNestedClip } from './videoEditNesting'
import { placeVideoEditDrop } from './videoEditDrop'
import { nestVideoEditClipsCapability } from '@/core/application-control/domains/videoEdit/videoEditNestCapability'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {} async updateDocument() {} async present() { return { presented: true, bitmap: { close() {} } } } async dispose() {}
} }))
beforeEach(installHarnessNativeStorage)
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditProject()
  editVideoProject(owner.document.id, document => {
    document.media = [{ id: 'media', name: '镜头', path: '/fixture/shot.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 20, hasAudio: true }]
    document.items = [{ id: 'item', name: '镜头', kind: 'video', mediaId: 'media' }]
    const sequence = document.sequences[0]; const base = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, duration: 60 })
    sequence.clips = [{ ...base, id: 'a', linkId: 'pair', sourceComponent: 'video' }, { ...base, id: 'sound', kind: 'audio', track: sequence.tracks.find(track => track.kind === 'audio')!.index, linkId: 'pair', sourceComponent: 'audio' }]
    return document
  })
  return owner
}
it('UI 共用变换：一步撤销、双击定位子序列并复用标签、序列行可拖入父序列', async () => {
  const owner = await fixture(); const before = structuredClone(owner.document); const history = owner.past.length
  const parent = owner.document.sequences[0]
  const result = nestVideoEditSelection({ projectId: owner.document.id, sequenceId: parent.id, clipIds: ['a'] }, '嵌套镜头')
  expect(result.movedClipIds).toEqual(['a', 'sound']); expect(owner.past.length).toBe(history + 1)
  openVideoEditNestedClip(owner.document.id, result.clip.id, 45)
  expect(owner.activeSequenceId).toBe(result.sequence.id); expect(owner.frame).toBe(15)
  const drop = placeVideoEditDrop(owner.document, [result.sequence.id], parent.id, { frame: 120, track: result.clip.track }, { targetTrackIds: [] })
  expect(drop.placedClips).toMatchObject([{ kind: 'sequence', duration: 60 }])
  expect(() => placeVideoEditDrop(owner.document, [parent.id], result.sequence.id, { frame: 90, track: result.clip.track }, { targetTrackIds: [] })).toThrow()
  undoVideoEdit(owner.document.id)
  expect(owner.document.sequences).toEqual(before.sequences); expect(owner.document.items).toEqual(before.items)
})
it('正式能力嵌套保存回读，通用属性能读写序列片段，拒绝循环素材引用', async () => {
  const owner = await fixture(); const app = createApplicationHarness()
  try {
    const result = await app.call('nest_video_edit_clips', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, clipRefs: [{ kind: 'video_edit.clip', id: `${owner.document.id}:a` }], name: '助手嵌套' })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { verification: { verified: true } } })
    if (!result.ok) throw new Error('嵌套失败')
    const input = nestVideoEditClipsCapability.inputSchema.parse({ documentRef: { kind: 'video_edit.document', id: owner.document.id }, clipRefs: [{ kind: 'video_edit.clip', id: `${owner.document.id}:a` }], name: '助手嵌套' })
    const output = nestVideoEditClipsCapability.outputSchema.parse(result.data)
    const effects = nestVideoEditClipsCapability.resolveObservedEffects!(input, output)
    expect(effects.map(effect => [effect.effect, effect.entityTypes, effect.count])).toEqual([
      ['execute', ['video_edit.document'], 1], ['create', ['video_edit.sequence'], 1], ['create', ['video_edit.item'], 1], ['create', ['video_edit.clip'], 1], ['update', ['video_edit.sequence'], 1], ['update', ['video_edit.clip'], 2],
    ])
    for (const effect of effects) {
      expect(effect.verified).toBe(true)
      expect(nestVideoEditClipsCapability.control.impacts.some(impact => impact.effect === effect.effect && effect.entityTypes.every(type => impact.entityTypes.includes(type)))).toBe(true)
    }
    expect(output.parentSequenceRef.id).toBe(`${owner.document.id}:${owner.document.sequences[0].id}`)
    expect(output.movedClipRefs.map(ref => ref.id)).toEqual(['a', 'sound'].map(id => `${owner.document.id}:${id}`))
    const clip = owner.document.sequences[0].clips[0]
    expect(savedVideoEdit(owner).sequences).toEqual(owner.document.sequences)
    expect((await app.read({ kind: 'video_edit.clip', id: `${owner.document.id}:${clip.id}` }, ['video_edit.clip.kind', 'video_edit.clip.speed_percent'])).properties).toMatchObject({ 'video_edit.clip.kind': 'sequence', 'video_edit.clip.speed_percent': 100 })
    expect((await app.read({ kind: 'video_edit.item', id: `${owner.document.id}:${clip.itemId}` }, ['video_edit.item.sequence_id'])).properties).toEqual({ 'video_edit.item.sequence_id': owner.document.sequences[1].id })
    const itemRef = { kind: 'video_edit.item', id: `${owner.document.id}:${clip.itemId}` }
    expect(await app.change(itemRef, { 'video_edit.item.sequence_id': owner.document.sequences[0].id })).toMatchObject({ ok: false })
    expect(await app.change({ kind: 'video_edit.clip', id: `${owner.document.id}:${clip.id}` }, { 'video_edit.clip.volume': .25, 'video_edit.clip.speed_percent': 50 })).toMatchObject({ ok: true })
    expect(owner.document.sequences[0].clips[0]).toMatchObject({ volume: .25, duration: 120 })
    await app.requireResult('undo_video_edit', { documentRef: { kind: 'video_edit.document', id: owner.document.id } })
    await app.requireResult('undo_video_edit', { documentRef: { kind: 'video_edit.document', id: owner.document.id } })
    expect(owner.document.sequences).toHaveLength(1)
  } finally { app.dispose() }
})
