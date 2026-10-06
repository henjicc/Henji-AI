// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { applyVideoEditBuiltinEffect, resetVideoEditEffect, updateVideoEditBuiltinEffect } from './videoEditCompositing'
import { appendVideoEditClip, beginVideoEditGesture, closeVideoEditProject, createVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'

// 试渲染只替换像素边界；领域校验、事务、注册与读回都是正式实现。
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/builtin-effects.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})
async function project() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); appendVideoEditClip(id)
  const sequence = getActiveVideoEditSequence(owner)
  return { owner, id, sequenceId: sequence.id, clipIds: sequence.clips.map(clip => clip.id) }
}

it('效果面板拖放或双击：同一效果加到所选全部画面片段，默认参数，整体一步撤销；锁定轨道与声音片段跳过', async () => {
  const { owner, id, sequenceId, clipIds } = await project()
  const history = owner.past.length
  const created = applyVideoEditBuiltinEffect(id, sequenceId, clipIds, 'gaussian_blur')
  expect(created).toHaveLength(2); expect(owner.past).toHaveLength(history + 1)
  for (const clip of getActiveVideoEditSequence(owner).clips) expect(clip.effects).toEqual([expect.objectContaining({ name: '高斯模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: { strength: 30, dimensions: 'both', repeat_edges: true } } })])
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.every(clip => !clip.effects?.length)).toBe(true)
  const track = getActiveVideoEditSequence(owner).clips[0].track
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, tracks: sequence.tracks.map(value => value.index === track ? { ...value, locked: true } : value) })) }))
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, clipIds, 'mosaic')).toThrow('锁定轨道')
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, clipIds, 'nope')).toThrow('可用：')
})

it('效果控件拖动参数只记一步撤销、数值夹进范围；重置回到默认', async () => {
  const { owner, id, sequenceId, clipIds } = await project()
  const [effectId] = applyVideoEditBuiltinEffect(id, sequenceId, [clipIds[0]], 'vignette')
  const target = { projectId: id, sequenceId, clipId: clipIds[0] }
  const params = () => getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params
  const history = owner.past.length
  const drag = beginVideoEditGesture(id)
  for (const amount of [40, 60, 90, 180]) updateVideoEditBuiltinEffect(target, effectId, { params: { amount } }, drag)
  expect(params().amount).toBe(100); expect(owner.past).toHaveLength(history)
  finishVideoEditGesture(drag)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(params().amount).toBe(30)
  updateVideoEditBuiltinEffect(target, effectId, { amount: .4, enabled: false, params: { feather: 80 } })
  expect(() => updateVideoEditBuiltinEffect(target, effectId, { params: { radius: 3 } })).toThrow('可用参数')
  await resetVideoEditEffect(target, effectId)
  expect(getActiveVideoEditSequence(owner).clips[0].effects![0]).toMatchObject({ enabled: true, amount: 1, builtin: { params: { amount: 30, midpoint: 50, feather: 50 } } })
})

it('助手经通用实体读写：读内置效果目录与参数语义，创建、修改、删除片段上的内置效果', async () => {
  const { owner, id, sequenceId, clipIds } = await project()
  const app = createApplicationHarness()
  try {
    const catalog = await app.read({ kind: 'video_edit.builtin_effect', id: `${id}:effect:gaussian_blur` }, ['video_edit.builtin_effect.name', 'video_edit.builtin_effect.params'])
    const properties = (catalog as { properties: Record<string, unknown> }).properties
    expect(properties['video_edit.builtin_effect.name']).toBe('高斯模糊')
    expect(properties['video_edit.builtin_effect.params']).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'strength', min: 0, max: 100, default: 30, unit: 'strength' })]))
    const clipRef = { kind: 'video_edit.clip', id: `${id}:${clipIds[0]}` }
    const baseline = await app.read(clipRef)
    const created = await app.call('change_application_entities', { summary: '背景虚化', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:gaussian_blur', 'video_edit.effect.parameters': { strength: 45 } } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]
    expect(effect.builtin).toEqual({ id: 'gaussian_blur', params: { strength: 45 } })
    const ref = { kind: 'video_edit.effect', id: `${id}:${effect.id}` }
    expect((await app.read(ref, ['video_edit.effect.definition_id', 'video_edit.effect.parameters', 'video_edit.effect.version_id'])).properties).toMatchObject({ 'video_edit.effect.definition_id': 'effect:gaussian_blur', 'video_edit.effect.parameters': { strength: 45 }, 'video_edit.effect.version_id': '' })
    const changed = await app.change(ref, { 'video_edit.effect.parameters': { strength: 70, dimensions: 'horizontal' } }); expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params).toEqual({ strength: 70, dimensions: 'horizontal' })
    const rejected = await app.change(ref, { 'video_edit.effect.parameters': { strength: 170 } })
    expect(rejected.ok).toBe(false); expect(JSON.stringify(rejected)).toContain('0–100')
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.strength).toBe(70)
    const before = await app.read(clipRef)
    const removed = await app.call('change_application_entities', { summary: '去掉模糊', changes: [{ kind: 'remove_items', entityType: 'video_edit.effect', parent: clipRef, targets: [ref] }] }, before.revisions as Record<string, number>)
    expect(removed, JSON.stringify(removed)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips[0].effects ?? []).toEqual([])
    expect(sequenceId).toBeTruthy()
  } finally { app.dispose() }
})
