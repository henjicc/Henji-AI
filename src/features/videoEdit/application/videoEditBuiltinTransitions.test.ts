// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { applyVideoEditTransitionToSelection, updateVideoEditTransitionParams } from './videoEditTransitions'
import { appendVideoEditClip, beginVideoEditGesture, closeVideoEditProject, createVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, undoVideoEdit } from './videoEditService'
import { endVideoEditEffectDrag, handleVideoEditEffectDragOver, VIDEO_EDIT_EFFECT_DRAG_TYPE, videoEditEffectDropClips, videoEditEffectDropTarget } from '../panels/videoEditEffectDrag'

// 任务 4.7 视频过渡与效果拖放落点：试渲染只替换像素边界；领域校验、事务、注册与读回都是正式实现。
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/builtin-transitions.henji-video')
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

it('效果控件拖动过渡参数只记一步撤销、数值夹进范围；未知参数报错', async () => {
  const { owner, id, sequenceId, clipIds } = await project()
  setVideoEditTimelineView(id, { selectedClipIds: clipIds })
  await applyVideoEditTransitionToSelection(id, 'iris_round')
  const transition = getActiveVideoEditSequence(owner).transitions!.find(value => value.leftClipId && value.rightClipId)!
  const params = () => getActiveVideoEditSequence(owner).transitions!.find(value => value.id === transition.id)!.parameters
  const history = owner.past.length
  const drag = beginVideoEditGesture(id)
  for (const feather of [20, 60, 140]) updateVideoEditTransitionParams(id, sequenceId, transition.id, { feather }, drag)
  expect(params()).toMatchObject({ feather: 100, mode: 'open', center_x: 50 }); expect(owner.past).toHaveLength(history)
  finishVideoEditGesture(drag); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(params()).toBeUndefined()
  updateVideoEditTransitionParams(id, sequenceId, transition.id, { mode: 'close' })
  expect(params()).toMatchObject({ mode: 'close', feather: 5 })
  expect(() => updateVideoEditTransitionParams(id, sequenceId, transition.id, { direction: 'from_left' })).toThrow('可用参数')
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
    const created = await app.call('change_application_entities', { summary: '擦除转场', changes: [{ kind: 'create_items', entityType: 'video_edit.transition', parent: sequenceRef, items: [{ properties: { 'video_edit.transition.kind': 'wipe', 'video_edit.transition.left_clip_id': clipIds[0], 'video_edit.transition.right_clip_id': clipIds[1], 'video_edit.transition.duration_frames': 10, 'video_edit.transition.parameters': { direction: 'from_top' } } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const transition = getActiveVideoEditSequence(owner).transitions![0]
    expect(transition).toMatchObject({ kind: 'wipe', parameters: { direction: 'from_top' } })
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
  } finally { app.dispose() }
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
