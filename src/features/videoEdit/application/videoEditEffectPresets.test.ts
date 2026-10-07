import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { videoEditEffectsRegistry } from '@/core/videoEdit/effectsRegistry'
import { makeVideoEditBuiltinEffect, applyVideoEditBuiltinEffect } from './videoEditCompositing'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { createVideoEditEffectLibraryStore, filterVideoEditLibraryEntries, useVideoEditEffectLibraryStore, videoEditUserPresetEntries, VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY } from './videoEditEffectPresets'
import { videoEditEffectDropClips } from '../panels/videoEditEffectDrag'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))
beforeEach(() => {
  installHarnessNativeStorage()
  useVideoEditEffectLibraryStore.setState({ favorites: [], presets: [] })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue(path.resolve(path.sep, 'preset-test.henji-video'))
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage(); localStorage.clear()
})
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
async function project() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); appendVideoEditClip(id)
  appendVideoEditMedia(id, { id: 'sound', name: '声音', path: path.resolve(path.sep, 'sound.wav'), kind: 'audio', width: 0, height: 0, durationSeconds: 2, hasAudio: true })
  const sequence = getActiveVideoEditSequence(owner)
  appendVideoEditClip(id, 'sound', { frame: 0, track: sequence.tracks.find(track => track.kind === 'audio')!.index })
  return { owner, id, sequenceId: sequence.id, pictures: sequence.clips.map(clip => clip.id), sound: getActiveVideoEditSequence(owner).clips.find(clip => clip.kind === 'audio')!.id }
}

it('搜索名称、别名、分类、分组、说明，忽略大小写与全角；清空返回完整目录', () => {
  const entries = videoEditEffectsRegistry()
  expect(filterVideoEditLibraryEntries(entries, '高斯').map(entry => entry.builtinId)).toContain('gaussian_blur')
  expect(filterVideoEditLibraryEntries(entries, 'GAUSSIAN BLUR').map(entry => entry.builtinId)).toEqual(['gaussian_blur'])
  expect(filterVideoEditLibraryEntries([{ ...entries[0], aliases: ['叠化'] }], '叠化')).toHaveLength(1)
  expect(filterVideoEditLibraryEntries(entries, '音频效果').every(entry => entry.media === 'audio')).toBe(true)
  expect(filterVideoEditLibraryEntries(entries, 'gaussian_blur').map(entry => entry.builtinId)).toEqual(['gaussian_blur'])
  const effect = entries.find(entry => entry.builtinId === 'gaussian_blur')!
  expect(filterVideoEditLibraryEntries([effect], effect.description.slice(0, 6))).toEqual([effect])
  expect(filterVideoEditLibraryEntries(entries, '不存在的效果')).toEqual([])
  expect(filterVideoEditLibraryEntries(entries, '  ')).toEqual(entries)
})

it('收藏、参数组合、重命名与删除经本机设置持久保存；写失败不发布新状态', () => {
  const disk = storage(); const first = createVideoEditEffectLibraryStore(disk)
  first.getState().toggleFavorite('effect:gaussian_blur'); first.getState().toggleFavorite('transition:cross_dissolve')
  const preset = first.getState().savePreset('清晰对白', [makeVideoEditBuiltinEffect('high_pass', { frequency: 100 }), makeVideoEditBuiltinEffect('compressor')])
  first.getState().renamePreset(preset.id, '对白处理')
  const restored = createVideoEditEffectLibraryStore(disk)
  expect(restored.getState().favorites).toEqual(['effect:gaussian_blur', 'transition:cross_dissolve'])
  expect(restored.getState().presets[0]).toMatchObject({ name: '对白处理', media: 'audio', effects: preset.effects })
  restored.getState().toggleFavorite('effect:gaussian_blur'); restored.getState().deletePreset(preset.id)
  expect(createVideoEditEffectLibraryStore(disk).getState()).toMatchObject({ favorites: ['transition:cross_dissolve'], presets: [] })
  const previous = restored.getState(); const written = disk.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)
  vi.spyOn(disk, 'setItem').mockImplementation(() => { throw new Error('storage full') })
  expect(() => restored.getState().toggleFavorite('effect:mosaic')).toThrow('storage full')
  expect(restored.getState()).toBe(previous); expect(disk.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)).toBe(written)
  const corrupt = storage(); corrupt.setItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY, '{broken')
  const broken = createVideoEditEffectLibraryStore(corrupt)
  expect(broken.getState().loadError).toBeTruthy()
  expect(() => broken.getState().toggleFavorite('effect:mosaic')).toThrow('保留原数据')
  expect(corrupt.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)).toBe('{broken')
})

it('保存参数强度开关与作用区域；手绘形状可选保存，跟踪绑定不会流入其他片段', () => {
  const library = createVideoEditEffectLibraryStore(storage()).getState()
  const effect = { ...makeVideoEditBuiltinEffect('mosaic'), enabled: false, amount: .45, mask: { regionId: 'face' as const, invert: true, feather: 25, expand: 10 } }
  expect(library.savePreset('人脸处理', [effect]).effects[0]).toMatchObject(effect)
  const shapes = { ...effect, mask: { regionId: 'shapes' as const, shapes: [{ id: 'shape', kind: 'rect' as const, points: [[.2,.1,0,0,0,0],[.5,.1,0,0,0,0],[.5,.5,0,0,0,0],[.2,.5,0,0,0,0]] as import('@/core/videoEdit/effectMasks').VideoEditMaskPoint[], follow: { trackerId: 'original', reference: [0, 0, 1, 1] as [number, number, number, number] } }] } }
  expect(library.savePreset('不含形状', [shapes]).effects[0].mask).toBeUndefined()
  const saved = library.savePreset('含形状', [shapes], true)
  expect(saved.effects[0].mask).toEqual({ regionId: 'shapes', shapes: [{ id: 'shape', kind: 'rect', points: [[.2,.1,0,0,0,0],[.5,.1,0,0,0,0],[.5,.5,0,0,0,0],[.2,.5,0,0,0,0]] }] })
  expect(shapes.mask.shapes[0].follow).toBeDefined()
  expect(() => library.savePreset('混合媒介', [effect, makeVideoEditBuiltinEffect('high_pass')])).toThrow('同媒介')
})

it('预设组合拖放/双击共用应用入口，长链跨片段一步撤销；媒介不匹配拒绝', async () => {
  const { owner, id, sequenceId, pictures, sound } = await project()
  const preset = useVideoEditEffectLibraryStore.getState().savePreset('画面组合', [makeVideoEditBuiltinEffect('gaussian_blur', { strength: 65 }), { ...makeVideoEditBuiltinEffect('mosaic'), amount: .3, enabled: false }])
  const templateRef = `preset:${preset.id}`
  const before = owner.past.length
  const created = applyVideoEditBuiltinEffect(id, sequenceId, [...pictures, sound], templateRef)
  expect(created).toHaveLength(4); expect(new Set(created).size).toBe(4); expect(owner.past).toHaveLength(before + 1)
  for (const clip of getActiveVideoEditSequence(owner).clips.filter(clip => clip.kind !== 'audio')) expect(clip.effects?.map(({ id: _id, ...effect }) => effect)).toEqual(preset.effects.map(({ id: _id, ...effect }) => effect))
  expect(videoEditEffectDropClips(getActiveVideoEditSequence(owner), pictures[0], [...pictures, sound], templateRef)).toEqual(pictures)
  expect(videoEditEffectDropClips(getActiveVideoEditSequence(owner), sound, [], templateRef)).toEqual([])
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.every(clip => !clip.effects?.length)).toBe(true)
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, [sound], templateRef)).toThrow('画面片段')
  const audio = useVideoEditEffectLibraryStore.getState().savePreset('对白', [makeVideoEditBuiltinEffect('high_pass')])
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, pictures, `preset:${audio.id}`)).toThrow('声音片段')
  applyVideoEditBuiltinEffect(id, sequenceId, [sound, ...pictures], `preset:${audio.id}`)
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === sound)?.effects?.[0].builtin?.id).toBe('high_pass')
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => clip.id === pictures[1] ? { ...clip, effects: Array.from({ length: 40 }, () => makeVideoEditBuiltinEffect('mosaic')) } : clip) })) }))
  const baseline = owner.document; const history = owner.past.length
  expect(applyVideoEditBuiltinEffect(id, sequenceId, pictures, templateRef)).toHaveLength(4)
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === pictures[1])?.effects).toHaveLength(42)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document).toEqual({ ...baseline, revision: owner.document.revision })
})

it('助手正式目录可读预设，并经现有效果集合写入整组；与手动入口结果相同且一步撤销', async () => {
  const { owner, id, pictures } = await project()
  const preset = useVideoEditEffectLibraryStore.getState().savePreset('颜色组合', Array.from({ length: 24 }, (_, index) => makeVideoEditBuiltinEffect(index % 2 ? 'vignette' : 'brightness_contrast')))
  expect(filterVideoEditLibraryEntries(videoEditUserPresetEntries([preset]), '颜色组合 视频预设')).toHaveLength(1)
  const app = createApplicationHarness()
  try {
    const listed = await app.requireResult('list_application_entities', { entityType: 'video_edit.effect_preset', limit: 20, propertyIds: ['video_edit.effect_preset.name'], where: { 'video_edit.effect_preset.name': preset.name } })
    expect(listed.refs).toEqual([expect.objectContaining({ kind: 'video_edit.effect_preset', id: preset.id })])
    const read = await app.read({ kind: 'video_edit.effect_preset', id: preset.id }, ['video_edit.effect_preset.name', 'video_edit.effect_preset.media', 'video_edit.effect_preset.creation_items'])
    const parent = { kind: 'video_edit.clip', id: `${id}:${pictures[0]}` }
    const baseline = await app.read(parent); const history = owner.past.length
    const properties = read.properties as Record<string, unknown>
    const result = await app.call('change_application_entities', { summary: '应用颜色组合', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent, items: properties['video_edit.effect_preset.creation_items'] }] }, baseline.revisions as Record<string, number>)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect(owner.past).toHaveLength(history + 1)
    expect(getActiveVideoEditSequence(owner).clips[0].effects?.map(effect => effect.builtin)).toEqual(preset.effects.map(effect => effect.builtin))
    const after = await app.read(parent)
    expect(await app.call('change_application_entities', { summary: '再次添加整组效果', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent, items: properties['video_edit.effect_preset.creation_items'] }] }, after.revisions as Record<string, number>)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips[0].effects).toHaveLength(48)
    undoVideoEdit(id)
    const ids = getActiveVideoEditSequence(owner).clips[0].effects!.map(effect => effect.id).reverse()
    expect(await app.change(parent, { 'video_edit.clip.effect_ids': ids })).toMatchObject({ ok: true })
    expect((await app.read(parent, ['video_edit.clip.effect_ids'])).properties).toMatchObject({ 'video_edit.clip.effect_ids': ids })
    undoVideoEdit(id)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].effects ?? []).toEqual([])
  } finally { app.dispose() }
})
