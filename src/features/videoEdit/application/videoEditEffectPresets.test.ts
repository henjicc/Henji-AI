import fs from 'node:fs'
import { VIDEO_EDIT_EFFECT_LIBRARY_VERSION } from '@/core/videoEdit/effectPresets'
import { videoEditStyleLibrary } from './videoEditStyleLibrary'
import { createTestStyleLibraryIo } from './videoEditStyleTestKit'
import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getHostScopeRevisions } from '@/features/application-control/hostContext/hostContext'
import { videoEditEffectsRegistry } from '@/core/videoEdit/effectsRegistry'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import { blurAmountForSigma } from '@/core/videoEdit/blur'
import { makeVideoEditBuiltinEffect, applyVideoEditBuiltinEffect } from './videoEditCompositing'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit, videoEditDomainRevision } from './videoEditService'
import { resolveVideoEditLibraryEffects, videoEditPresetCreationProperties, createVideoEditEffectLibraryStore, filterVideoEditLibraryEntries, useVideoEditEffectLibraryStore, videoEditUserPresetEntries, VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY } from './videoEditEffectPresets'
import { videoEditEffectDropClips } from '../panels/videoEditEffectDrag'
import { videoEditPresetCreationItemsSchema, VideoEditStylePieceCollectionExecutor } from './videoEditEffectPresetReflection'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))
beforeEach(() => {
  installHarnessNativeStorage()
  useVideoEditEffectLibraryStore.setState({ favorites: [], presets: [] })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue(path.resolve(path.sep, 'preset-test.hjvid'))
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
  expect(filterVideoEditLibraryEntries(entries, '模糊').map(entry => entry.builtinId)).toContain('blur')
  expect(filterVideoEditLibraryEntries(entries, 'BLUR').map(entry => entry.builtinId)).toContain('blur')
  expect(filterVideoEditLibraryEntries([{ ...entries[0], aliases: ['叠化'] }], '叠化')).toHaveLength(1)
  expect(filterVideoEditLibraryEntries(entries, '音频效果').every(entry => entry.media === 'audio')).toBe(true)
  expect(filterVideoEditLibraryEntries(entries, 'blur').map(entry => entry.builtinId)).toContain('blur')
  const effect = entries.find(entry => entry.builtinId === 'blur')!
  expect(filterVideoEditLibraryEntries([effect], effect.description.slice(0, 6))).toEqual([effect])
  expect(filterVideoEditLibraryEntries(entries, '不存在的效果')).toEqual([])
  expect(filterVideoEditLibraryEntries(entries, '  ')).toEqual(entries)
})

it('贝塞尔过冲预设应用到较短片段，修剪后参数仍可持久保存', async () => {
  const { owner, id, sequenceId, pictures } = await project()
  const clip = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === pictures[0])!
  const effect = makeVideoEditBuiltinEffect('blur')
  effect.builtin!.curves = { amount: [{ time: 0, value: 0, interpolation: 'bezier', bezier: [1 / 3, 3, 2 / 3, 3] }, { time: (clip.duration - 1) * 2, value: 0.03, interpolation: 'linear' }] }
  const preset = useVideoEditEffectLibraryStore.getState().savePreset('模糊动画', [effect])
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, [clip.id], `preset:${preset.id}`)).not.toThrow()
  const points = getActiveVideoEditSequence(owner).clips.find(value => value.id === clip.id)!.effects![0].builtin!.curves!.amount
  expect(points.at(-1)?.time).toBe(clip.duration - 1)
  expect(points.at(-1)?.value).toBeCloseTo(0.07125, 6)
  expect(points[0].easeValues).toEqual([0, 0.03])
})
it('收藏、参数组合、重命名与删除经本机设置持久保存；写失败不发布新状态', () => {
  const disk = storage(); const first = createVideoEditEffectLibraryStore(disk)
  first.getState().toggleFavorite('effect:blur'); first.getState().toggleFavorite('transition:cross_dissolve')
  const preset = first.getState().savePreset('清晰对白', [makeVideoEditBuiltinEffect('audio_filter', { mode: 'high_pass', high_pass_frequency: 100 }), makeVideoEditBuiltinEffect('compressor')])
  first.getState().renamePreset(preset.id, '对白处理')
  const restored = createVideoEditEffectLibraryStore(disk)
  expect(restored.getState().favorites).toEqual(['effect:blur', 'transition:cross_dissolve'])
  expect(restored.getState().presets[0]).toMatchObject({ name: '对白处理', media: 'audio', effects: preset.effects })
  restored.getState().toggleFavorite('effect:blur'); restored.getState().deletePreset(preset.id)
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
  expect(() => library.savePreset('混合媒介', [effect, makeVideoEditBuiltinEffect('audio_filter')])).toThrow('同媒介')
})

it('预设组合拖放/双击共用应用入口，长链跨片段一步撤销；媒介不匹配拒绝', async () => {
  const { owner, id, sequenceId, pictures, sound } = await project()
  const preset = useVideoEditEffectLibraryStore.getState().savePreset('画面组合', [makeVideoEditBuiltinEffect('blur', { amount: 0.0195 }), { ...makeVideoEditBuiltinEffect('mosaic'), amount: .3, enabled: false }])
  const templateRef = `preset:${preset.id}`
  const before = owner.past.length
  const created = applyVideoEditBuiltinEffect(id, sequenceId, [...pictures, sound], templateRef)
  expect(created).toHaveLength(4); expect(new Set(created).size).toBe(4); expect(owner.past).toHaveLength(before + 1)
  for (const clip of getActiveVideoEditSequence(owner).clips.filter(clip => clip.kind !== 'audio')) expect(clip.effects?.map(({ id: _id, ...effect }) => effect)).toEqual(preset.effects.map(({ id: _id, ...effect }) => effect))
  expect(videoEditEffectDropClips(getActiveVideoEditSequence(owner), pictures[0], [...pictures, sound], templateRef)).toEqual(pictures)
  expect(videoEditEffectDropClips(getActiveVideoEditSequence(owner), sound, [], templateRef)).toEqual([])
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.every(clip => !clip.effects?.length)).toBe(true)
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, [sound], templateRef)).toThrow('画面片段')
  const audio = useVideoEditEffectLibraryStore.getState().savePreset('对白', [makeVideoEditBuiltinEffect('audio_filter')])
  expect(() => applyVideoEditBuiltinEffect(id, sequenceId, pictures, `preset:${audio.id}`)).toThrow('声音片段')
  applyVideoEditBuiltinEffect(id, sequenceId, [sound, ...pictures], `preset:${audio.id}`)
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === sound)?.effects?.[0].builtin?.id).toBe('audio_filter')
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => clip.id === pictures[1] ? { ...clip, effects: Array.from({ length: 40 }, () => makeVideoEditBuiltinEffect('mosaic')) } : clip) })) }))
  const baseline = owner.document; const history = owner.past.length
  expect(applyVideoEditBuiltinEffect(id, sequenceId, pictures, templateRef)).toHaveLength(4)
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === pictures[1])?.effects).toHaveLength(42)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document).toEqual({ ...baseline, revision: owner.document.revision })
})

it('助手正式目录可读预设，并经现有效果集合写入整组；与手动入口结果相同且一步撤销', async () => {
  const { owner, id, pictures } = await project()
  const preset = useVideoEditEffectLibraryStore.getState().savePreset('颜色组合', Array.from({ length: 24 }, (_, index) => makeVideoEditBuiltinEffect(index % 2 ? 'vignette' : 'color_grade')))
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

it('本机预设库里有已移除的效果时照样读入、原样保留，旧暗角换算；应用预设时跳过已移除的效果', async () => {
  const disk = storage()
  const removed = { id: 'r', name: '亮度与对比度', enabled: true, amount: 1, builtin: { id: 'brightness_contrast', params: { brightness: -35 } } }
  const dark = { id: 'v', name: '暗角', enabled: true, amount: 1, builtin: { id: 'vignette', params: { amount: -30 } } }
  disk.setItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY, JSON.stringify({ version: 2, state: { favorites: ['effect:brightness_contrast'], presets: [{ id: 'old', name: '旧组合', media: 'video', effects: [removed, dark] }] } }))
  const store = createVideoEditEffectLibraryStore(disk)
  expect(store.getState().loadError).toBe('')
  // 已移除的效果原样保留；旧暗角的负数量读入时换成正数量配白色。
  expect(store.getState().presets[0].effects).toEqual([removed, { ...dark, builtin: { id: 'vignette', params: { amount: 30, color: WHITE_HEX } } }])
  useVideoEditEffectLibraryStore.setState({ presets: store.getState().presets })
  expect(resolveVideoEditLibraryEffects('preset:old')?.effects.map(effect => effect.builtin?.id)).toEqual(['vignette'])
  const items = videoEditPresetCreationItemsSchema.parse(videoEditPresetCreationProperties(store.getState().presets[0]).map(properties => ({ properties })))
  expect(items.map(item => item.properties['video_edit.effect.definition_id'])).toEqual(['effect:vignette'])
  const { owner, id, sequenceId, pictures } = await project()
  applyVideoEditBuiltinEffect(id, sequenceId, [pictures[0]], 'preset:old')
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === pictures[0])!.effects?.map(effect => effect.builtin?.id)).toEqual(['vignette'])
})

it('历史库先备份再迁移且读取不改写原件；失败不覆盖原件，更新版本保留未知字段', () => {
  for (const version of [1, 2]) {
    const disk = storage(), key = VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY
    const raw = fs.readFileSync(`tests/fixtures/persistence/video-effect-library/v${version}.json`, 'utf8')
    disk.setItem(key, raw)
    const store = createVideoEditEffectLibraryStore(disk)
    expect(store.getState().presets[0]).toMatchObject({ knobs: [], effects: [{ amount: .4, builtin: { params: { amount: expect.closeTo(blurAmountForSigma(.01), 2) } } }] })
    expect(disk.getItem(key)).toBe(raw); expect(disk.getItem(`${key}:backup:v${version}`)).toBe(raw)
    store.getState().renamePreset(store.getState().presets[0].id, '已确认的名称')
    expect(createVideoEditEffectLibraryStore(disk).getState().presets[0].name).toBe('已确认的名称')
    const failed = storage(); failed.setItem(key, raw)
    vi.spyOn(failed, 'setItem').mockImplementation(() => { throw new Error('备份失败') })
    const blocked = createVideoEditEffectLibraryStore(failed)
    expect(blocked.getState().loadError).toBeTruthy()
    expect(() => blocked.getState().renamePreset('missing', '不能保存')).toThrow()
    expect(failed.getItem(key)).toBe(raw)
  }
  const disk = storage(), key = VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY
  const futureVersion = VIDEO_EDIT_EFFECT_LIBRARY_VERSION + 1
  disk.setItem(key, JSON.stringify({ version: futureVersion, minReaderVersion: VIDEO_EDIT_EFFECT_LIBRARY_VERSION, content: { favorites: [], presets: [], futureTaste: { contrast: 3 } } }))
  const forward = createVideoEditEffectLibraryStore(disk)
  forward.getState().savePreset('未来库内新增', [makeVideoEditBuiltinEffect('mosaic')])
  expect(JSON.parse(disk.getItem(key)!)).toMatchObject({ version: futureVersion, minReaderVersion: VIDEO_EDIT_EFFECT_LIBRARY_VERSION, content: { futureTaste: { contrast: 3 } } })
})

it('公共入口创建与修改全局风格件并按说明检索，风格成员沿正式属性写入和读回', async () => {
  const io = createTestStyleLibraryIo({ builtin: false }); videoEditStyleLibrary.reset(io, undefined)
  const app = createApplicationHarness(), parent = { kind: 'video_edit.style_library', id: 'singleton' }
  try {
    const animated = makeVideoEditBuiltinEffect('blur')
    animated.builtin!.curves = { amount: [{ time: 0, value: .01, interpolation: 'linear' }, { time: 10, value: .02, interpolation: 'linear' }] }
    const definition = { name: '柔和背景', media: 'video', description: '弱化背景细节', usage: '标题底图', effects: [animated], knobs: [] }
    const before = await app.read(parent)
    const result = await app.call('change_application_entities', { summary: '保存用户确认的风格件', changes: [{ kind: 'create_items', entityType: 'video_edit.effect_preset', parent, items: [{ properties: { 'video_edit.effect_preset.definition': definition } }] }] }, before.revisions as Record<string, number>)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    const listed = await app.requireResult('list_application_entities', { entityType: 'video_edit.effect_preset', limit: 10, where: { 'video_edit.effect_preset.description': '弱化背景细节' } })
    const ref = (listed.refs as Array<{ kind: string; id: string }>)[0]
    expect(ref).toBeDefined()
    const read = await app.read(ref, ['video_edit.effect_preset.definition'])
    expect((read.properties as Record<string, unknown>)['video_edit.effect_preset.definition']).toMatchObject(definition)
    expect(read.revisions).not.toEqual(before.revisions)
    const saved = useVideoEditEffectLibraryStore.getState().presets[0]
    const duplicate = await app.call('change_application_entities', { summary: '拒绝重名风格件', changes: [{ kind: 'create_items', entityType: 'video_edit.effect_preset', parent, items: [{ properties: { 'video_edit.effect_preset.definition': definition } }] }] })
    expect(duplicate).toMatchObject({ ok: false, error: { message: expect.stringContaining(definition.name) } })
    expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([saved])
    const malformed = await app.change(ref, { 'video_edit.effect_preset.definition': { ...saved, extra_definition: true } })
    expect(malformed).toMatchObject({ ok: false, error: { message: expect.stringContaining('extra_definition') } })
    const changed = { ...saved, description: '用户确认的更柔和背景' }
    const modification = await app.change(ref, { 'video_edit.effect_preset.definition': changed })
    expect(modification).toMatchObject({ ok: true })
    expect(useVideoEditEffectLibraryStore.getState().presets[0].description).toBe(changed.description)
    if (!modification.ok) throw new Error('修改未成功')
    await app.requireResult('undo_application_changes', { undoRef: modification.data.undoRef })
    expect(useVideoEditEffectLibraryStore.getState().presets[0]).toEqual(saved)
    const snapshot = structuredClone(useVideoEditEffectLibraryStore.getState().presets)
    const rejected = await app.call('change_application_entities', { summary: '拒绝不完整的批次', changes: [{ kind: 'create_items', entityType: 'video_edit.effect_preset', parent, items: [{ properties: { 'video_edit.effect_preset.definition': definition } }, { properties: { 'video_edit.effect_preset.definition': { ...definition, effects: [] } } }] }] }, (await app.read(parent)).revisions as Record<string, number>)
    expect(rejected.ok).toBe(false)
    expect(useVideoEditEffectLibraryStore.getState().presets).toEqual(snapshot)
    const styleResult = await app.call('change_application_entities', { summary: '创建个人风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style', parent, items: [{ properties: { 'video_edit.style.name': '个人风格' } }] }] }, (await app.read(parent)).revisions as Record<string, number>)
    expect(styleResult, JSON.stringify(styleResult)).toMatchObject({ ok: true })
    const style = videoEditStyleLibrary.listStyles()[0].style
    const scoped = { ...saved }
    const styleRef = { kind: 'video_edit.style', id: style.id }
    expect(await app.change(styleRef, { 'video_edit.style.effect_presets': [scoped] })).toMatchObject({ ok: true })
    expect(videoEditStyleLibrary.requireStyle(style.id).style.effectPresets).toEqual([scoped])
    const { owner, id, sequenceId, pictures } = await project()
    const { bindVideoEditStyle } = await import('./videoEditStyles')
    await bindVideoEditStyle(id, sequenceId, style.id)
    const copy = await app.read({ kind: 'video_edit.project_style', id: `${id}:${style.id}` }, ['video_edit.project_style.effect_presets'])
    const pieces = (copy.properties as Record<string, Array<{ creation_items: Array<{ properties: Record<string, unknown> }> }>>)['video_edit.project_style.effect_presets']
    const global = await app.read(ref, ['video_edit.effect_preset.creation_items'])
    expect(pieces[0].creation_items).toEqual((global.properties as Record<string, unknown>)['video_edit.effect_preset.creation_items'])
    const clip = { kind: 'video_edit.clip', id: `${id}:${pictures[0]}` }
    await app.requireResult('change_application_entities', { summary: '应用工程风格件', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clip, items: pieces[0].creation_items }] })
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.curves).toEqual(animated.builtin!.curves)
  } finally { app.dispose(); videoEditStyleLibrary.reset(); io.dispose() }
})

it('所有效果库写入口拒绝重名且不发布，成功操作和收藏只推进效果库自己的修订', () => {
  const store = useVideoEditEffectLibraryStore
  const domain = videoEditDomainRevision(), baseline = getHostScopeRevisions()
  const a = store.getState().savePreset('柔化', [makeVideoEditBuiltinEffect('blur')])
  const b = store.getState().savePreset('对白', [makeVideoEditBuiltinEffect('audio_filter')])
  const snapshot = store.getState(), written = localStorage.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)
  for (const write of [
    () => store.getState().savePreset(' 柔化 ', a.effects),
    () => store.getState().renamePreset(b.id, a.name),
    () => store.getState().importPresets([a]),
    () => store.getState().restoreLibrary({ favorites: [], presets: [a, { ...b, name: a.name }] }),
  ]) {
    expect(write).toThrow(/柔化/)
    expect(store.getState()).toBe(snapshot)
    expect(localStorage.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)).toBe(written)
  }
  store.getState().toggleFavorite(`preset:${a.id}`)
  expect(videoEditDomainRevision()).toBe(domain)
  expect(getHostScopeRevisions()['video_edit.effects']).toBeGreaterThan(baseline['video_edit.effects'])
})

it('旧库的多组重名可逐项修复，收藏不受影响，也不能引入新的重名', () => {
  const disk = storage()
  const presets = ['甲', '甲', '乙', '乙'].map((name, index) => ({ id: `inherited-${index}`, name, media: 'video', effects: [makeVideoEditBuiltinEffect('blur')] }))
  disk.setItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY, JSON.stringify({ version: 2, content: { favorites: [], presets } }))
  const store = createVideoEditEffectLibraryStore(disk)
  store.getState().toggleFavorite('preset:inherited-0')
  store.getState().renamePreset('inherited-0', '甲一')
  store.getState().deletePreset('inherited-2')
  expect(store.getState().presets.map(preset => preset.name)).toEqual(['甲一', '甲', '乙'])
  expect(() => store.getState().savePreset('甲', presets[0].effects)).toThrow(/甲/)
  expect(createVideoEditEffectLibraryStore(disk).getState().favorites).toEqual(['preset:inherited-0'])
})

it('修复历史重名后可经正式事务撤销，后续重名失败也能完整补偿', async () => {
  const presets = ['duplicate-a', 'duplicate-b'].map(id => ({ id, name: '历史柔化', media: 'video' as const, effects: [makeVideoEditBuiltinEffect('blur')] }))
  useVideoEditEffectLibraryStore.setState({ presets, favorites: [] })
  const app = createApplicationHarness(), ref = { kind: 'video_edit.effect_preset', id: presets[0].id }
  try {
    const change = await app.change(ref, { 'video_edit.effect_preset.definition': { ...presets[0], name: '独立柔化' } })
    expect(change).toMatchObject({ ok: true })
    if (!change.ok) throw new Error('改名失败')
    await app.requireResult('undo_application_changes', { undoRef: change.data.undoRef })
    expect(useVideoEditEffectLibraryStore.getState().presets).toEqual(presets)
    const result = await app.call('change_application_entities', { summary: '第二步重名时补偿前一步', changes: presets.map(preset => ({ kind: 'set_properties', entityType: ref.kind, target: { kind: ref.kind, id: preset.id }, properties: { 'video_edit.effect_preset.definition': { ...preset, name: '同一个新名称' } } })) })
    expect(result.ok).toBe(false)
    expect(useVideoEditEffectLibraryStore.getState().presets).toEqual(presets)
    const current = structuredClone(useVideoEditEffectLibraryStore.getState().presets)
    expect(() => useVideoEditEffectLibraryStore.getState().restoreLibrary({ favorites: [], presets: [] }, { favorites: [], presets: [] })).toThrow(/后续修改/)
    expect(useVideoEditEffectLibraryStore.getState().presets).toEqual(current)
  } finally { app.dispose() }
})

it('旋钮默认映射在片段应用、公共创建项和 look 中一致，映射参数不再被原曲线覆盖', async () => {
  const { resolveAuthorEffects } = await import('@/core/videoEdit/authorEffects')
  const { look } = await import('../authorLibraries/effects')
  const { owner, id, sequenceId, pictures } = await project()
  const effect = makeVideoEditBuiltinEffect('blur', { amount: .01 })
  effect.builtin!.curves = { amount: [{ time: 0, value: .02, interpolation: 'linear' }] }
  const [preset] = useVideoEditEffectLibraryStore.getState().importPresets([{ id: 'mapped', name: '柔化', media: 'video', effects: [effect], knobs: [{ key: 'soft', name: '柔和度', min: 0, max: 100, default: 75, mappings: [{ effectId: effect.id, parameter: 'amount', points: [{ input: 0, output: 0 }, { input: 100, output: .04 }] }] }] }])
  const authored = resolveAuthorEffects([look(preset.name)], { presets: [preset] })[0]
  const creation = videoEditPresetCreationProperties(preset)[0]
  applyVideoEditBuiltinEffect(id, sequenceId, [pictures[0]], `preset:${preset.id}`)
  const applied = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === pictures[0])!.effects![0]
  expect(creation['video_edit.effect.parameters']).toEqual(applied.builtin!.params)
  expect(applied.builtin!.params.amount).toBe(authored.params.amount)
  expect(applied.builtin!.curves).toBeUndefined()
  expect(preset.effects[0].builtin!.curves).toBeUndefined()
  expect(effect.builtin!.curves).toBeDefined()
  const stored = JSON.parse(localStorage.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)!).content.presets[0]
  expect(stored.effects).toEqual(preset.effects)
  expect(stored.effects[0].builtin.params.amount).toBe(authored.params.amount)
})

it('正式撤销栈遗忘事务时释放风格件快照', async () => {
  const executor = new VideoEditStylePieceCollectionExecutor()
  const result = await executor.apply({ kind: 'collection', entityType: 'video_edit.effect_preset', expectedRevisions: {}, parent: { kind: 'video_edit.style_library', id: 'singleton' }, operation: { kind: 'create', items: [{ properties: { 'video_edit.effect_preset.definition': { name: '可回收', media: 'video', effects: [makeVideoEditBuiltinEffect('blur')] } } }] } }, { signal: new AbortController().signal } as Parameters<typeof executor.apply>[1])
  executor.forget(result.undoToken!)
  await expect(executor.undo(result.undoToken!)).rejects.toThrow(/撤销记录不存在/)
})

it('旧音频库备份后只在内存迁移，收藏合并去重，保存与重开保持音频预设', () => {
  const disk = storage()
  const source = JSON.parse(fs.readFileSync('tests/fixtures/audio-effect-merge/effect_library.json', 'utf8'))
  source.content.favorites = ['effect:chorus', 'effect:flanger', 'effect:polarity_invert', 'effect:gain_balance']
  const raw = JSON.stringify(source)
  disk.setItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY, raw)
  const store = createVideoEditEffectLibraryStore(disk)
  expect(store.getState().loadError).toBe('')
  expect(store.getState().favorites).toEqual(['effect:modulation', 'effect:gain_balance'])
  expect(disk.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)).toBe(raw)
  expect(disk.getItem(`${VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY}:backup:v3`)).toBe(raw)
  const preset = store.getState().presets[0]
  expect(preset.media).toBe('audio')
  expect(preset.effects.every(effect => videoEditEffectsRegistry().some(entry => entry.id === `effect:${effect.builtin?.id}`))).toBe(true)
  store.getState().renamePreset(preset.id, '迁移后的对白')
  const persisted = JSON.parse(disk.getItem(VIDEO_EDIT_EFFECT_LIBRARY_STORAGE_KEY)!)
  expect(persisted.version).toBeGreaterThan(source.version)
  expect(persisted.minReaderVersion).toBeGreaterThan(source.version)
  expect(createVideoEditEffectLibraryStore(disk).getState().presets[0]).toEqual(store.getState().presets[0])
})
