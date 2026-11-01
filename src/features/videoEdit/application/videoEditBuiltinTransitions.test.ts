import { BLACK_HEX } from '@/core/theme/colorTokens'
import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { applyVideoEditTransitionToSelection, updateVideoEditTransitionParams } from './videoEditTransitions'
import { appendVideoEditClip, beginVideoEditGesture, closeVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, undoVideoEdit } from './videoEditService'
import { endVideoEditEffectDrag, handleVideoEditEffectDragOver, VIDEO_EDIT_EFFECT_DRAG_TYPE, videoEditEffectDropClips, videoEditEffectDropTarget } from '../panels/videoEditEffectDrag'
import { dropVideoEditGenerator } from './videoEditGenerators'

// 任务 4.7 视频过渡与效果拖放落点：试渲染只替换像素边界；领域校验、事务、注册与读回都是正式实现。
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/builtin-transitions.hjvid')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})
/** 同一轨道上首尾相接的两个片段。 */
async function project() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id, undefined, { frame: 0, track: 1 })
  const first = getActiveVideoEditSequence(owner).clips[0]
  appendVideoEditClip(id, undefined, { frame: first.duration, track: 1 })
  const sequence = getActiveVideoEditSequence(owner)
  return { owner, id, sequenceId: sequence.id, clipIds: sequence.clips.map(clip => clip.id) }
}

it('效果面板双击过渡：放到所选片段两端的编辑点（相接处为普通过渡、空白一端为单侧过渡），一步撤销', async () => {
  const { owner, id, clipIds } = await project()
  setVideoEditTimelineView(id, { selectedClipIds: clipIds })
  const history = owner.past.length
  const created = await applyVideoEditTransitionToSelection(id, 'wipe')
  expect(created).toHaveLength(3); expect(owner.past).toHaveLength(history + 1)
  const transitions = getActiveVideoEditSequence(owner).transitions!
  expect(transitions.every(transition => transition.kind === 'wipe' && !transition.parameters)).toBe(true)
  expect(transitions.filter(transition => transition.leftClipId && transition.rightClipId)).toHaveLength(1)
  await expect(applyVideoEditTransitionToSelection(id, 'constant_power')).rejects.toThrow('声音片段')
  setVideoEditTimelineView(id, { selectedClipIds: [] })
  await expect(applyVideoEditTransitionToSelection(id, 'push')).rejects.toThrow('先在时间线上选中片段')
})

it('公共创建和换种类拒绝已移除与合并来源，已有移除项仍可改时长、换为目录项', async () => {
  const { owner, id, sequenceId, clipIds } = await project()
  const app = createApplicationHarness()
  const parent = { kind: 'video_edit.sequence', id: `${id}:${sequenceId}` }
  try {
    for (const [kind, reason] of [['gl.Bounce', '已移除'], ['shaders.IrisWipe', '已合并到 shape_wipe']]) {
      const result = await app.call('change_application_entities', { summary: '创建转场', changes: [{ kind: 'create_items', entityType: 'video_edit.transition', parent, items: [{ properties: { 'video_edit.transition.kind': kind, 'video_edit.transition.right_clip_id': clipIds[0], 'video_edit.transition.duration_frames': 10 } }] }] })
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).toContain(reason)
      expect(JSON.stringify(result)).toContain('可用条目')
      expect(getActiveVideoEditSequence(owner).transitions ?? []).toHaveLength(0)
    }
    editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id === sequenceId ? { ...sequence, transitions: [{ id: 'removed-transition', kind: 'gl.Bounce', rightClipId: clipIds[0], durationFrames: 10 }] } : sequence) }))
    const ref = { kind: 'video_edit.transition', id: `${id}:removed-transition` }
    expect(await app.change(ref, { 'video_edit.transition.duration_frames': 12 })).toMatchObject({ ok: true })
    const rejected = await app.change(ref, { 'video_edit.transition.kind': 'shaders.IrisWipe' })
    expect(rejected.ok).toBe(false); expect(JSON.stringify(rejected)).toContain('已合并到 shape_wipe')
    expect(await app.change(ref, { 'video_edit.transition.kind': 'shape_wipe' })).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).transitions![0]).toMatchObject({ kind: 'shape_wipe', durationFrames: 12 })
  } finally { await app.dispose() }
})

it('效果控件拖动过渡参数只记一步撤销、数值夹进范围；未知参数报错', async () => {
  const { owner, id, sequenceId, clipIds } = await project()
  setVideoEditTimelineView(id, { selectedClipIds: clipIds })
  await applyVideoEditTransitionToSelection(id, 'shape_wipe')
  const transition = getActiveVideoEditSequence(owner).transitions!.find(value => value.leftClipId && value.rightClipId)!
  const params = () => getActiveVideoEditSequence(owner).transitions!.find(value => value.id === transition.id)!.parameters
  const history = owner.past.length
  const drag = beginVideoEditGesture(id)
  for (const feather of [20, 60, 140]) updateVideoEditTransitionParams(id, sequenceId, transition.id, { feather }, drag)
  expect(params()).toMatchObject({ feather: 100, mode: 'circle', operation: 'open', center_x: 50 }); expect(owner.past).toHaveLength(history)
  finishVideoEditGesture(drag); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(params()).toBeUndefined()
  updateVideoEditTransitionParams(id, sequenceId, transition.id, { operation: 'close' })
  expect(params()).toMatchObject({ mode: 'circle', operation: 'close', feather: 5 })
  expect(() => updateVideoEditTransitionParams(id, sequenceId, transition.id, { missing_parameter: 'from_left' })).toThrow('可用参数')
})

it('助手经通用实体读写：目录里读过渡用途与参数，创建带参数的过渡、整体改参数、换种类回到默认、越界被拒', async () => {
  const { owner, id, sequenceId, clipIds } = await project()
  const app = createApplicationHarness()
  try {
    const catalog = await app.read({ kind: 'video_edit.builtin_effect', id: `${id}:transition:wipe` }, ['video_edit.builtin_effect.name', 'video_edit.builtin_effect.params'])
    const properties = (catalog as { properties: Record<string, unknown> }).properties
    expect(properties['video_edit.builtin_effect.name']).toBe('擦除')
    expect(properties['video_edit.builtin_effect.params']).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'direction', options: expect.arrayContaining(['from_left', 'from_top_right']) }), expect.objectContaining({ key: 'feather', min: 0, max: 100, default: 10 })]))
    const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${sequenceId}` }
    const baseline = await app.read(sequenceRef)
    const created = await app.call('change_application_entities', { summary: '擦除转场', changes: [{ kind: 'create_items', entityType: 'video_edit.transition', parent: sequenceRef, items: [{ properties: { 'video_edit.transition.kind': 'wipe', 'video_edit.transition.left_clip_id': clipIds[0], 'video_edit.transition.right_clip_id': clipIds[1], 'video_edit.transition.duration_frames': 10, 'video_edit.transition.parameters': { direction: 'from_top' }, 'video_edit.transition.frame_curves': { feather: [{ time: 0, value: 5, interpolation: 'bezier', bezier: [.2, 0, .8, 1] }, { time: 9, value: 80, interpolation: 'linear' }] } } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const transition = getActiveVideoEditSequence(owner).transitions![0]
    expect(transition).toMatchObject({ kind: 'wipe', parameters: { direction: 'from_top' } })
    expect(transition.frameCurves!.feather[0].bezier).toEqual([.2, 0, .8, 1])
    const ref = { kind: 'video_edit.transition', id: `${id}:${transition.id}` }
    const changed = await app.change(ref, { 'video_edit.transition.parameters': { direction: 'from_right', border: 30 } }); expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).transitions![0].parameters).toEqual({ direction: 'from_right', border: 30 })
    const rejected = await app.change(ref, { 'video_edit.transition.parameters': { feather: 300 } })
    expect(rejected.ok).toBe(false); expect(JSON.stringify(rejected)).toContain('0–100')
    const kind = await app.change(ref, { 'video_edit.transition.kind': 'flash' }); expect(kind, JSON.stringify(kind)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).transitions![0]).toMatchObject({ kind: 'flash' })
    expect(getActiveVideoEditSequence(owner).transitions![0].parameters).toBeUndefined()
    expect((await app.read(ref, ['video_edit.transition.parameters'])).properties).toMatchObject({ 'video_edit.transition.parameters': {} })
    const audio = await app.change(ref, { 'video_edit.transition.kind': 'constant_gain' }); expect(audio.ok).toBe(false)
  } finally { await app.dispose() }
})

it('拖效果经过时间线：高亮松手会加上效果的片段（落在所选片段上为全部所选），声音片段与锁定轨道跳过，结束拖动清掉', async () => {
  const { owner, id, clipIds } = await project()
  const sequence = getActiveVideoEditSequence(owner)
  expect(videoEditEffectDropClips(sequence, clipIds[0], clipIds)).toEqual(clipIds)
  expect(videoEditEffectDropClips(sequence, clipIds[0], [clipIds[1]])).toEqual([clipIds[0]])
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, tracks: value.tracks.map(track => track.index === 1 ? { ...track, locked: true } : track) })) }))
  expect(videoEditEffectDropClips(getActiveVideoEditSequence(owner), clipIds[0], clipIds)).toEqual([])
  const element = document.createElement('div'); element.setAttribute('data-video-edit-clip', clipIds[1])
  const dataTransfer = { types: [VIDEO_EDIT_EFFECT_DRAG_TYPE], getData: () => 'mosaic', dropEffect: 'none' } as unknown as DataTransfer
  const event = { dataTransfer, target: element, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} }
  expect(handleVideoEditEffectDragOver(event, id, { sequence, selectedClipIds: [] })).toBe(true)
  expect(videoEditEffectDropTarget()).toEqual({ projectId: id, clipIds: [clipIds[1]] }); expect(dataTransfer.dropEffect).toBe('copy')
  handleVideoEditEffectDragOver(event, id, { sequence: getActiveVideoEditSequence(owner), selectedClipIds: [] })
  expect(videoEditEffectDropTarget()).toBeNull(); expect(dataTransfer.dropEffect).toBe('none')
  handleVideoEditEffectDragOver(event, id, { sequence, selectedClipIds: [] }); endVideoEditEffectDrag()
  expect(videoEditEffectDropTarget()).toBeNull()
})

it('生成器拖到轨道空白处新建整幅黑底图形片段，生成器是它效果链的第一项，一步撤销；落在片段上仍按效果加到片段', async () => {
  const { owner, id, sequenceId } = await project()
  const before = getActiveVideoEditSequence(owner)
  const frame = Math.max(...before.clips.map(clip => clip.start + clip.duration)) + 10
  const clipId = await dropVideoEditGenerator(id, sequenceId, 'noise', { frame, track: 1 })
  const sequence = getActiveVideoEditSequence(owner), clip = sequence.clips.find(value => value.id === clipId)!
  expect(clip).toMatchObject({ kind: 'graphic', start: frame, name: '噪声' })
  expect(clip.graphic!.objects[0].parameters).toMatchObject({ x: 0, y: 0, width: sequence.width, height: sequence.height, fill: [0, 0, 0, 1] })
  expect(clip.effects?.map(effect => effect.builtin?.id)).toEqual(['noise'])
  expect(owner.selection).toBe(clipId)
  undoVideoEdit(id)
  expect(getActiveVideoEditSequence(owner).clips.map(value => value.id)).toEqual(before.clips.map(value => value.id))
  expect(owner.document.items.some(item => item.id === clip.itemId)).toBe(false)
})

it('助手用通用集合组合生成器：目录读参、创建整幅图形、放入片段、加生成器并改参，失败事务不留半项', async () => {
  const { owner, id, sequenceId } = await project()
  const app = createApplicationHarness()
  const projectRef = { kind: 'video_edit.document', id }
  const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${sequenceId}` }
  const create = async (entityType: string, parent: { kind: string; id: string }, properties: Record<string, unknown>) => {
    const baseline = await app.read(parent)
    return app.call('change_application_entities', { summary: '创建生成背景', changes: [{ kind: 'create_items', entityType, parent, items: [{ properties }] }] }, baseline.revisions as Record<string, number>)
  }
  try {
    const catalog = await app.read({ kind: 'video_edit.builtin_effect', id: `${id}:effect:noise` }, ['video_edit.builtin_effect.params'])
    expect(JSON.stringify(catalog.properties)).toContain('柏林')
    expect(await create('video_edit.item', projectRef, { 'video_edit.item.kind': 'graphic', 'video_edit.item.graphic_kind': 'solid', 'video_edit.item.name': '生成背景' })).toMatchObject({ ok: true })
    const item = owner.document.items.find(value => value.name === '生成背景')!
    expect(await create('video_edit.clip', sequenceRef, { 'video_edit.clip.item_id': item.id, 'video_edit.clip.kind': 'graphic', 'video_edit.clip.name': item.name, 'video_edit.clip.start': 300, 'video_edit.clip.duration': 60, 'video_edit.clip.track': 1 })).toMatchObject({ ok: true })
    const clip = getActiveVideoEditSequence(owner).clips.find(value => value.itemId === item.id)!
    const clipRef = { kind: 'video_edit.clip', id: `${id}:${clip.id}` }
    expect(await create('video_edit.effect', clipRef, { 'video_edit.effect.definition_id': 'effect:noise', 'video_edit.effect.parameters': { mode: 'simplex' } })).toMatchObject({ ok: true })
    const effect = getActiveVideoEditSequence(owner).clips.find(value => value.id === clip.id)!.effects![0]
    const effectRef = { kind: 'video_edit.effect', id: `${id}:${effect.id}` }
    expect(await app.change(effectRef, { 'video_edit.effect.parameters': { mode: 'perlin', scale: 75, color_b: `${BLACK_HEX}00` } })).toMatchObject({ ok: true })
    const actual = getActiveVideoEditSequence(owner).clips.find(value => value.id === clip.id)!
    expect(actual.graphic!.objects[0].parameters).toMatchObject({ x: 0, y: 0, width: actual.graphic!.width, height: actual.graphic!.height })
    expect(actual.effects![0].builtin).toMatchObject({ id: 'noise', params: { mode: 'perlin', scale: 75, color_b: `${BLACK_HEX}00` } })
    expect(((await app.read(effectRef, ['video_edit.effect.parameters'])).properties as Record<string, unknown>)['video_edit.effect.parameters']).toMatchObject({ mode: 'perlin', scale: 75, color_b: `${BLACK_HEX}00` })
    const before = structuredClone(actual.effects)
    expect(await create('video_edit.effect', clipRef, { 'video_edit.effect.definition_id': 'effect:noise', 'video_edit.effect.parameters': { mode: 'missing' } })).toMatchObject({ ok: false })
    expect(getActiveVideoEditSequence(owner).clips.find(value => value.id === clip.id)!.effects).toEqual(before)
  } finally { await app.dispose() }
})
