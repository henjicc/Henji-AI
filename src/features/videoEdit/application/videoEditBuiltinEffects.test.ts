import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
import { SHADER_GRAPH_EFFECT_DEFINITIONS } from '@/core/videoEdit/shaderGraph/effects'
import { SHADER_GRAPH_TRANSITION_PRESETS } from '@/core/videoEdit/shaderGraph/transitions'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { applyVideoEditBuiltinEffect, resetVideoEditEffect, updateVideoEditBuiltinEffect } from './videoEditCompositing'
import { appendVideoEditClip, beginVideoEditGesture, closeVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'

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

it('60 parameter moves preserve unrelated branches, defer full validation/save/history, then commit one undo step', async () => {
  const { owner, id, sequenceId, clipIds } = await project()
  const [effectId] = applyVideoEditBuiltinEffect(id, sequenceId, [clipIds[0]], 'color_grade')
  const before = owner.document; const history = owner.past.length; const gesture = beginVideoEditGesture(id)
  const clone = vi.spyOn(globalThis, 'structuredClone')
  for (let i = 1; i <= 60; i++) updateVideoEditBuiltinEffect({ projectId: id, sequenceId, clipId: clipIds[0] }, effectId, { params: { exposure: i / 60 } }, gesture)
  expect(owner.document.media).toBe(before.media)
  expect(owner.document.items).toBe(before.items)
  expect(owner.document.sequences[0].clips[1]).toBe(before.sequences[0].clips[1])
  expect(owner.past).toHaveLength(history)
  expect(clone.mock.calls.some(([value]) => typeof value === 'object' && value !== null && 'format' in value && value.format === 'henji-video-project')).toBe(false)
  clone.mockRestore()
  finishVideoEditGesture(gesture); expect(owner.past).toHaveLength(history + 1)
  expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.exposure).toBe(1)
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.exposure).toBe(before.sequences[0].clips[0].effects![0].builtin!.params.exposure)
  undoVideoEdit(id, true); expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.exposure).toBe(1)
})

it('shaders 组件效果与转场通过正式通用实体可读；助手创建滤镜、修改参数与手动撤销共用历史', async () => {
  const { id, clipIds, owner } = await project()
  const app = createApplicationHarness()
  try {
    for (const definition of SHADER_GRAPH_EFFECT_DEFINITIONS) {
      const catalog = await app.read({ kind: 'video_edit.builtin_effect', id: `${id}:effect:${definition.id}` }, ['video_edit.builtin_effect.name', 'video_edit.builtin_effect.params'])
      expect(catalog.properties).toMatchObject({ 'video_edit.builtin_effect.name': definition.name, 'video_edit.builtin_effect.params': expect.any(Array) })
    }
    for (const definition of SHADER_GRAPH_TRANSITION_PRESETS) {
      const catalog = await app.read({ kind: 'video_edit.builtin_effect', id: `${id}:transition:${definition.kind}` }, ['video_edit.builtin_effect.name'])
      expect(catalog.properties).toMatchObject({ 'video_edit.builtin_effect.name': definition.name })
    }
    const clipRef = { kind: 'video_edit.clip', id: `${id}:${clipIds[0]}` }
    const baseline = await app.read(clipRef)
    const history = owner.past.length
    const created = await app.call('change_application_entities', { summary: '波浪扭曲', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:shaders.WaveDistortion', 'video_edit.effect.parameters': { strength: 0.45 } } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    expect(owner.past).toHaveLength(history + 1)
    const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]
    const changed = await app.change({ kind: 'video_edit.effect', id: `${id}:${effect.id}` }, { 'video_edit.effect.parameters': { strength: 0.7, angle: 45 } })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.strength).toBe(0.7)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.strength).toBe(0.45)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].effects ?? []).toEqual([])
  } finally { app.dispose() }
})

it('效果面板拖放或双击：同一效果加到所选全部画面片段，默认参数，整体一步撤销；锁定轨道与声音片段跳过', async () => {
  const { owner, id, sequenceId, clipIds } = await project()
  const history = owner.past.length
  const created = applyVideoEditBuiltinEffect(id, sequenceId, clipIds, 'gaussian_blur')
  expect(created).toHaveLength(2); expect(owner.past).toHaveLength(history + 1)
  for (const clip of getActiveVideoEditSequence(owner).clips) expect(clip.effects).toEqual([expect.objectContaining({ name: '高斯模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: { sigma_fraction_height: 0.009, axis: 'both', edge_mode: 'clamp' } } })])
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
    expect(properties['video_edit.builtin_effect.params']).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'sigma_fraction_height', min: 0, default: 0.009, unit: 'fraction_height' })]))
    const clipRef = { kind: 'video_edit.clip', id: `${id}:${clipIds[0]}` }
    const baseline = await app.read(clipRef)
    const created = await app.call('change_application_entities', { summary: '背景虚化', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:gaussian_blur', 'video_edit.effect.parameters': { sigma_fraction_height: 0.0135 } } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]
    expect(effect.builtin).toEqual({ id: 'gaussian_blur', params: { sigma_fraction_height: 0.0135 } })
    const ref = { kind: 'video_edit.effect', id: `${id}:${effect.id}` }
    expect((await app.read(ref, ['video_edit.effect.definition_id', 'video_edit.effect.parameters', 'video_edit.effect.version_id'])).properties).toMatchObject({ 'video_edit.effect.definition_id': 'effect:gaussian_blur', 'video_edit.effect.parameters': { sigma_fraction_height: 0.0135 }, 'video_edit.effect.version_id': '' })
    const changed = await app.change(ref, { 'video_edit.effect.parameters': { sigma_fraction_height: 0.021, axis: 'horizontal' } }); expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params).toEqual({ sigma_fraction_height: 0.021, axis: 'horizontal' })
    const rejected = await app.change(ref, { 'video_edit.effect.parameters': { sigma_fraction_height: -1 } })
    expect(rejected.ok).toBe(false); expect(JSON.stringify(rejected)).toContain('0–')
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.sigma_fraction_height).toBe(0.021)
    const before = await app.read(clipRef)
    const removed = await app.call('change_application_entities', { summary: '去掉模糊', changes: [{ kind: 'remove_items', entityType: 'video_edit.effect', parent: clipRef, targets: [ref] }] }, before.revisions as Record<string, number>)
    expect(removed, JSON.stringify(removed)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips[0].effects ?? []).toEqual([])
    expect(sequenceId).toBeTruthy()
  } finally { app.dispose() }
})
