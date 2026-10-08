import { createVideoEditTestProject as createVideoEditProject } from '../application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { appendVideoEditClip, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, subscribeVideoEdit, undoVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { applyVideoEditBuiltinEffect } from '../application/videoEditCompositing'
import { VideoEditEffectsPanel } from './VideoEditEffectsPanel'
import { addVideoEditTextClipAt } from '../application/videoEditTimeline'
import { VideoEditTimelineKeyframes } from '../timeline/VideoEditTimelineKeyframes'
import { captureVideoEditCommandContext, executeVideoEditCommand } from '../application/videoEditCommands'
import { videoEditClipValue } from '@/core/videoEdit/keyframes'
import { matchVideoEditShortcut } from '@/core/videoEdit/commands'
import { requireVideoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import { useVideoEditEffectLibraryStore } from '../application/videoEditEffectPresets'
import * as codeTrial from '../application/videoEditCodeTrial'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/textMeasurement', () => ({ measureElementTextWidth: () => 30 }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks(): void {}
  async updateDocument(): Promise<void> {}
  async present(): Promise<{ presented: boolean; bitmap: { close: () => void } }> { return { presented: true, bitmap: { close(): void {} } } }
  async dispose(): Promise<void> {}
} }))
beforeEach(() => {
  useVideoEditEffectLibraryStore.setState({ favorites: [], presets: [] })
  installHarnessNativeStorage()
  vi.stubGlobal('PointerEvent', class extends MouseEvent { readonly pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue(path.resolve(path.sep, 'keyframes.henji-video'))
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => {
  cleanup()
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
  localStorage.clear()
})
async function project() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id)
  const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips[0]
  setVideoEditView(id, { frame: clip.start, selection: clip.id })
  return { owner, id, sequenceId: sequence.id, clipId: clip.id, clip: () => getActiveVideoEditSequence(owner).clips[0] }
}
function Panel({ owner }: { owner: VideoEditInstance }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  return <VideoEditEffectsPanel instance={owner} onError={error => { throw error }} />
}
function Pen({ owner }: { owner: VideoEditInstance }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const sequence = getActiveVideoEditSequence(owner)
  return <VideoEditTimelineKeyframes projectId={owner.document.id} sequenceId={sequence.id} clip={sequence.clips[0]} pen={owner.tool === 'pen'} width={200} height={60} pixels={2} onError={error => { throw error }} />
}
it('固有效果不展示颜色和亮度', async () => {
  const { owner } = await project()
  const panel = render(<Panel owner={owner} />); const ui = within(panel.container)
  expect(panel.container.querySelector('[data-video-edit-effect-section="color"]')).toBeNull()
  expect(ui.queryByRole('spinbutton', { name: '亮度' })).toBeNull()
  expect(ui.queryByRole('button', { name: '启用亮度关键帧' })).toBeNull()
})

it('从附加效果标题打开预设面板，默认全选，按链顺序只保存勾选子集', async () => {
  const { owner, id, sequenceId, clipId } = await project()
  const panel = render(<Panel owner={owner} />); const ui = within(panel.container)
  expect(ui.getByRole('button', { name: '保存为预设' }).hasAttribute('disabled')).toBe(true)
  act(() => {
    applyVideoEditBuiltinEffect(id, sequenceId, [clipId], 'gaussian_blur')
    applyVideoEditBuiltinEffect(id, sequenceId, [clipId], 'brightness_contrast')
    applyVideoEditBuiltinEffect(id, sequenceId, [clipId], 'lumetri_color')
  })
  const effects = within(panel.container.querySelector<HTMLElement>('[data-video-edit-effect-section="effects"]')!)
  expect(effects.queryByRole('checkbox')).toBeNull()
  expect(ui.queryByText('保存所选效果为预设…')).toBeNull()
  const save = ui.getByRole('button', { name: '保存为预设' })
  expect(save.closest('[data-video-edit-effect-section="effects"]')).toBeTruthy()
  fireEvent.click(save)
  const modal = within(within(document.body).getByRole('dialog', { name: '保存为预设' }))
  const checkboxes = modal.getAllByRole('checkbox')
  expect(checkboxes).toHaveLength(3)
  for (const checkbox of checkboxes) expect(checkbox.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(modal.getByRole('checkbox', { name: '保存效果：亮度与对比度' }))
  fireEvent.change(modal.getByRole('textbox', { name: '预设名称' }), { target: { value: '柔化调色' } })
  fireEvent.click(modal.getByRole('button', { name: '保存' }))
  const presets = useVideoEditEffectLibraryStore.getState().presets
  expect(presets).toHaveLength(1)
  expect(presets[0].name).toBe('柔化调色')
  expect(presets[0].effects.map(effect => effect.builtin?.id)).toEqual(['gaussian_blur', 'lumetri_color'])
  expect(within(document.body).queryByRole('dialog')).toBeNull()
})

it('效果控件秒表/当前帧自动加点/导航/删除/关闭；拖动和取消共用一步撤销', async () => {
  const { owner, id, clip } = await project()
  const panel = render(<Panel owner={owner} />); const ui = within(panel.container)
  fireEvent.click(ui.getByRole('button', { name: '启用不透明度关键帧' }))
  expect(clip().curves!.opacity).toEqual([{ time: 0, value: 1, interpolation: 'linear' }])
  act(() => setVideoEditView(id, { frame: 20 }))
  const before = owner.past.length
  const value = ui.getByRole('spinbutton', { name: '不透明度' })
  fireEvent.pointerDown(value, { pointerId: 1, button: 0, clientX: 100, clientY: 20 })
  fireEvent.pointerMove(value, { pointerId: 1, clientX: 50, clientY: 20 })
  fireEvent.pointerMove(value, { pointerId: 1, clientX: 25, clientY: 20 })
  fireEvent.pointerUp(value, { pointerId: 1 })
  expect(clip().curves!.opacity).toHaveLength(2)
  expect(clip().curves!.opacity![1].time).toBe(20)
  expect(clip().curves!.opacity![1].value).toBeLessThan(1)
  expect(owner.past).toHaveLength(before + 1)
  act(() => undoVideoEdit(id)); expect(clip().curves!.opacity).toHaveLength(1)
  expect(owner.frame).toBe(20)
  fireEvent.click(ui.getByRole('button', { name: '添加不透明度关键帧' }))
  expect(clip().curves!.opacity?.map(point => point.time)).toEqual([0, 20])
  fireEvent.click(ui.getByRole('button', { name: '上一个不透明度关键帧' }))
  expect(owner.frame).toBe(0)
  fireEvent.click(ui.getByRole('button', { name: '下一个不透明度关键帧' }))
  expect(owner.frame).toBe(20)
  fireEvent.click(ui.getByRole('button', { name: '不透明度关键帧轨与插值' }))
  expect(within(document.body).getByLabelText('不透明度迷你关键帧轨')).toBeTruthy()
  fireEvent.click(ui.getByRole('button', { name: '不透明度关键帧轨与插值' }))
  fireEvent.click(ui.getByRole('button', { name: '删除不透明度关键帧' }))
  expect(clip().curves!.opacity).toHaveLength(1)
  const at = owner.past.length
  fireEvent.pointerDown(value, { pointerId: 1, button: 0, clientX: 100, clientY: 20 })
  fireEvent.pointerMove(value, { pointerId: 1, clientX: 50, clientY: 20 })
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(owner.past).toHaveLength(at); expect(clip().curves!.opacity).toHaveLength(1)
  fireEvent.click(ui.getByRole('button', { name: '关闭不透明度关键帧' }))
  expect(clip().curves!.opacity).toBeUndefined()
  expect(owner.past).toHaveLength(at + 1)
})
it.each(['opacity', 'volume'] as const)('钢笔 P 编辑 %s：点击加点、拖动、Ctrl 删除、Esc 回退与标记可撤销', async key => {
  const { owner, id, clip } = await project()
  if (key === 'volume') editVideoProject(id, document => {
    const next = structuredClone(document); const sequence = next.sequences[0]; const selected = sequence.clips[0]
    next.media.push({ id: 'keyframe-audio', name: '声音', path: path.resolve(path.sep, 'keyframe-audio.wav'), kind: 'audio', width: 0, height: 0, durationSeconds: 10 })
    next.items = next.items.map(item => item.id === selected.itemId ? { id: item.id, name: item.name, kind: 'audio', mediaId: 'keyframe-audio' } : item)
    selected.kind = 'audio'; selected.track = sequence.tracks.find(track => track.kind === 'audio')!.index
    return next
  })
  const command = matchVideoEditShortcut({ code: 'KeyP', key: 'p', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false }, 'timeline', {})
  expect(command).toBe('pen_tool')
  await executeVideoEditCommand(captureVideoEditCommandContext(id, 'timeline'), command!)
  expect(owner.tool).toBe('pen')
  const pen = render(<Pen owner={owner} />)
  const svg = pen.container.querySelector('svg')!
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 60, right: 200, bottom: 60, x: 0, y: 0, toJSON: () => ({}) })
  const previous = owner.past.length
  fireEvent.pointerDown(svg, { button: 0, pointerId: 7, clientX: 20, clientY: 37 })
  fireEvent.pointerMove(svg, { pointerId: 7, clientX: 60, clientY: 30 })
  fireEvent.pointerUp(svg, { pointerId: 7 })
  expect(clip().curves![key]).toHaveLength(1)
  expect(clip().curves![key]![0].time).toBe(30)
  expect(clip().curves![key]![0].value).toBeGreaterThan(key === 'volume' ? 1 : 0)
  expect(owner.past).toHaveLength(previous + 1)
  const point = svg.querySelector('circle')!
  fireEvent.pointerDown(point, { button: 0, pointerId: 8, clientX: 60, clientY: 30, ctrlKey: true })
  expect(clip().curves![key]).toBeUndefined()
  act(() => undoVideoEdit(id)); expect(clip().curves![key]![0].time).toBe(30)
  fireEvent.pointerDown(svg, { button: 0, pointerId: 9, clientX: 80, clientY: 40 })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(clip().curves![key]).toHaveLength(1)
  act(() => { owner.tool = 'select'; setVideoEditView(id, { frame: 1 }) })
  expect(pen.container.querySelector('path')).toBeTruthy()
})
it('助手同一通用事务写运动与 Lumetri 序列、读回；越界拒绝并补偿前面的写入', async () => {
  const { id, sequenceId, clipId, clip } = await project()
  const [effectId] = applyVideoEditBuiltinEffect(id, sequenceId, [clipId], 'lumetri_color')
  const app = createApplicationHarness()
  const ref = { kind: 'video_edit.clip', id: `${id}:${clipId}` }; const effectRef = { kind: 'video_edit.effect', id: `${id}:${effectId}` }
  const points = [{ time: 0, value: 0, interpolation: 'ease' }, { time: 30, value: .5, interpolation: 'linear' }]
  try {
    const catalog = await app.read({ kind: 'video_edit.builtin_effect', id: `${id}:effect:lumetri_color` }, ['video_edit.builtin_effect.params']) as { properties: Record<string, unknown> }
    expect(catalog.properties['video_edit.builtin_effect.params']).toHaveLength(requireVideoEditBuiltinEffect('lumetri_color').params.length)
    const baseline = await app.read(ref)
    const changed = await app.call('change_application_entities', { summary: '动画与调色', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.clip.x.keyframes': points } }, { kind: 'set_properties', entityType: effectRef.kind, target: effectRef, properties: { 'video_edit.effect.frame_curves': { exposure: points.map(point => ({ ...point, value: point.value * 2 })) } } }] }, baseline.revisions as Record<string, number>)
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.clip.x.keyframes'])).properties).toMatchObject({ 'video_edit.clip.x.keyframes': points })
    expect((await app.read(effectRef, ['video_edit.effect.frame_curves'])).properties).toMatchObject({ 'video_edit.effect.frame_curves': { exposure: points.map(point => ({ ...point, value: point.value * 2 })) } })
    expect(videoEditClipValue(clip(), 'x', 15)).toBe(.25)
    const before = JSON.stringify(clip().curves)
    const nextBaseline = await app.read(ref)
    const rejected = await app.call('change_application_entities', { summary: '非法时刻', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.clip.x.keyframes': [{ time: 0, value: .8, interpolation: 'linear' }] } }, { kind: 'set_properties', entityType: effectRef.kind, target: effectRef, properties: { 'video_edit.effect.frame_curves': { exposure: [{ time: clip().duration, value: 1, interpolation: 'linear' }] } } }] }, nextBaseline.revisions as Record<string, number>)
    expect(rejected.ok).toBe(false); expect(JSON.stringify(rejected)).toContain(`0–${clip().duration - 1}`)
    expect(JSON.stringify(clip().curves)).toBe(before)
    const invalidValue = await app.change(effectRef, { 'video_edit.effect.frame_curves': { exposure: [{ time: 0, value: 500, interpolation: 'ease' }] } })
    expect(invalidValue.ok).toBe(false); expect(JSON.stringify(invalidValue)).toContain('曝光')
    const wheelPoints = points.map(point => ({ ...point, value: point.value * 60 }))
    const wheels = await app.change(effectRef, { 'video_edit.effect.frame_curves': { exposure: points.map(point => ({ ...point, value: point.value * 2 })), shadow_hue: wheelPoints } })
    expect(wheels, JSON.stringify(wheels)).toMatchObject({ ok: true })
    const create = await app.call('change_application_entities', { summary: '新建动画曝光', changes: [{ kind: 'create_items', entityType: effectRef.kind, parent: ref, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:lumetri_color', 'video_edit.effect.frame_curves': { exposure: points } } }] }] }, (await app.read(ref)).revisions as Record<string, number>)
    expect(create, JSON.stringify(create)).toMatchObject({ ok: true })
    expect(clip().effects?.at(-1)?.builtin?.curves?.exposure).toEqual(points)
    const shorter = await app.change(ref, { 'video_edit.clip.duration': 20 })
    expect(shorter, JSON.stringify(shorter)).toMatchObject({ ok: true })
    expect(clip().curves!.x!.at(-1)?.time).toBe(19)
    expect(clip().effects?.[0].builtin?.curves?.exposure.at(-1)?.time).toBe(19)
  } finally { app.dispose() }
})

it('选中在文字与画面片段间来回切换，效果控件顶部始终只有一行片段名', async () => {
  const { owner, id, sequenceId, clipId, clip } = await project()
  const textId = addVideoEditTextClipAt(id, sequenceId, clip().start + clip().duration, clip().track)
  const panel = render(<Panel owner={owner} />)
  for (const selection of [textId, clipId, textId, clipId]) act(() => setVideoEditView(id, { selection }))
  expect(panel.container.querySelectorAll('[data-video-edit-effects-clip-name]')).toHaveLength(1)
})

it('效果头部只选中，箭头单独折叠；强度最后，无源码不显示添加行；Delete只删效果并选择相邻项', async () => {
  const { owner, id, sequenceId, clipId, clip } = await project()
  applyVideoEditBuiltinEffect(id, sequenceId, [clipId], 'sharpen')
  applyVideoEditBuiltinEffect(id, sequenceId, [clipId], 'gaussian_blur')
  const trial = vi.spyOn(codeTrial, 'trialVideoEditCodeDocument').mockRejectedValue(new Error('不应试渲染'))
  const panel = render(<Panel owner={owner} />); const ui = within(panel.container)
  expect(ui.queryByRole('button', { name: '添加到片段' })).toBeNull()
  expect(ui.queryByText('暂无滤镜源码')).toBeNull()
  const [first, second] = clip().effects!
  const header = ui.getByRole('group', { name: `效果${first.name}` })
  const editor = () => panel.container.querySelector(`[data-video-edit-effect-editor="${first.id}"]`)
  expect(editor()).toBeTruthy()
  fireEvent.click(header); fireEvent.click(header)
  expect(header.getAttribute('data-selected')).toBe('true'); expect(editor()).toBeTruthy()
  const rows = editor()!.querySelectorAll('[data-video-edit-builtin-param]')
  expect(rows[rows.length - 1].getAttribute('data-video-edit-builtin-param')).toBe('amount')
  fireEvent.click(ui.getByRole('button', { name: `收起效果${first.name}` }))
  expect(editor()).toBeNull()
  fireEvent.click(header); expect(editor()).toBeNull()
  fireEvent.click(ui.getByRole('button', { name: `展开效果${first.name}` }))
  expect(editor()).toBeTruthy()
  const count = owner.past.length
  fireEvent.keyDown(ui.getAllByRole('spinbutton', { name: '效果强度' })[0], { code: 'Delete', key: 'Delete' })
  expect(clip().effects).toHaveLength(2)
  fireEvent.keyDown(ui.getByLabelText('效果控件'), { code: 'Delete', key: 'Delete' })
  expect(ui.queryByText('正在检查混合画面')).toBeNull()
  await waitFor(() => expect(clip().effects).toHaveLength(1))
  expect(ui.getByRole('group', { name: `效果${second.name}` }).getAttribute('data-selected')).toBe('true')
  expect(getActiveVideoEditSequence(owner).clips).toHaveLength(1)
  expect(owner.past).toHaveLength(count + 1); expect(trial).not.toHaveBeenCalled()
  fireEvent.keyDown(ui.getByLabelText('效果控件'), { code: 'Backspace', key: 'Backspace' })
  await waitFor(() => expect(clip().effects).toHaveLength(0))
})

it('拖动效果头部显示插入位置、一次撤销；Esc取消不提交', async () => {
  const { owner, id, sequenceId, clipId, clip } = await project()
  applyVideoEditBuiltinEffect(id, sequenceId, [clipId], 'gaussian_blur')
  applyVideoEditBuiltinEffect(id, sequenceId, [clipId], 'sharpen')
  const order = clip().effects!.map(effect => effect.id)
  const panel = render(<Panel owner={owner} />); const ui = within(panel.container)
  const headers = () => ui.getAllByRole('group', { name: /^效果/ }).filter(element => element.hasAttribute('data-selected'))
  const geometry = (): void => { headers().forEach((element, index) => { element.getBoundingClientRect = () => ({ top: index * 100, left: 0, width: 300, height: 28, right: 300, bottom: index * 100 + 28, x: 0, y: index * 100, toJSON: () => ({}) }) }) }
  geometry()
  fireEvent.mouseDown(headers()[0], { button: 0, clientX: 50, clientY: 14 })
  fireEvent.mouseMove(window, { clientX: 50, clientY: 45 })
  fireEvent.mouseMove(window, { clientX: 50, clientY: 114 })
  expect(panel.container.querySelector('[data-video-edit-effect-insertion]')).toBeTruthy()
  const count = owner.past.length
  fireEvent.mouseUp(window)
  await waitFor(() => expect(clip().effects!.map(effect => effect.id)).toEqual(order.slice().reverse()))
  expect(owner.past).toHaveLength(count + 1)
  act(() => undoVideoEdit(id)); expect(clip().effects!.map(effect => effect.id)).toEqual(order)
  geometry()
  fireEvent.mouseDown(headers()[0], { button: 0, clientX: 50, clientY: 14 })
  fireEvent.mouseMove(window, { clientX: 50, clientY: 45 })
  fireEvent.mouseMove(window, { clientX: 50, clientY: 114 })
  fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.mouseUp(window)
  expect(clip().effects!.map(effect => effect.id)).toEqual(order)
  expect(owner.past).toHaveLength(count)
})

it('分区开关保留效果状态和固有参数关键帧；助手通用读写同字段', async () => {
  const { owner, id, sequenceId, clipId, clip } = await project()
  applyVideoEditBuiltinEffect(id, sequenceId, [clipId], 'gaussian_blur')
  editVideoProject(id, draft => { const item = draft.sequences[0].clips[0]; item.effects![0].enabled = false; item.x = .3; item.curves = { x: [{ time: 0, value: .4, interpolation: 'linear' }] }; return draft })
  const original = structuredClone(clip())
  const panel = render(<Panel owner={owner} />); const ui = within(panel.container)
  const count = owner.past.length
  fireEvent.click(ui.getByRole('button', { name: '停用附加效果分区' }))
  expect(clip().effectsEnabled).toBe(false); expect(clip().effects).toEqual(original.effects)
  expect(owner.past).toHaveLength(count + 1)
  fireEvent.click(ui.getByRole('button', { name: '启用附加效果分区' }))
  expect(clip().effects).toEqual(original.effects)
  fireEvent.click(ui.getByRole('button', { name: '停用运动分区' }))
  expect(videoEditClipValue(clip(), 'x', clip().start)).toBe(0)
  expect(clip().x).toBe(.3); expect(clip().curves).toEqual(original.curves)
  const app = createApplicationHarness(); const ref = { kind: 'video_edit.clip', id: `${id}:${clipId}` }
  try {
    expect((await app.read(ref, ['video_edit.clip.effects_enabled', 'video_edit.clip.disabled_intrinsic_sections'])).properties).toEqual({ 'video_edit.clip.effects_enabled': true, 'video_edit.clip.disabled_intrinsic_sections': ['motion'] })
    const changed = await app.change(ref, { 'video_edit.clip.effects_enabled': false, 'video_edit.clip.disabled_intrinsic_sections': [] })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect(clip().effectsEnabled).toBe(false); expect(videoEditClipValue(clip(), 'x', clip().start)).toBe(.4)
    expect(clip().effects).toEqual(original.effects); expect(clip().curves).toEqual(original.curves)
  } finally { app.dispose() }
})
