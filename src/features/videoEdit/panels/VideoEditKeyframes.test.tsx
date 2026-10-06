// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { appendVideoEditClip, closeVideoEditProject, createVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, subscribeVideoEdit, undoVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { applyVideoEditBuiltinEffect } from '../application/videoEditCompositing'
import { VideoEditEffectsPanel } from './VideoEditEffectsPanel'
import { VideoEditTimelineKeyframes } from '../timeline/VideoEditTimelineKeyframes'
import { captureVideoEditCommandContext, executeVideoEditCommand } from '../application/videoEditCommands'
import { videoEditClipValue } from '@/core/videoEdit/keyframes'
import { matchVideoEditShortcut } from '@/core/videoEdit/commands'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/textMeasurement', () => ({ measureElementTextWidth: () => 30 }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks(): void {}
  async updateDocument(): Promise<void> {}
  async present(): Promise<{ presented: boolean; bitmap: { close: () => void } }> { return { presented: true, bitmap: { close(): void {} } } }
  async dispose(): Promise<void> {}
} }))
beforeEach(() => {
  installHarnessNativeStorage()
  vi.stubGlobal('PointerEvent', class extends MouseEvent { readonly pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue(path.resolve(path.sep, 'keyframes.henji-video'))
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => {
  cleanup()
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
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
    expect(catalog.properties['video_edit.builtin_effect.params']).toHaveLength(49)
    const baseline = await app.read(ref)
    const changed = await app.call('change_application_entities', { summary: '动画与调色', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.clip.x.keyframes': points } }, { kind: 'set_properties', entityType: effectRef.kind, target: effectRef, properties: { 'video_edit.effect.parameters.exposure.keyframes': points.map(point => ({ ...point, value: point.value * 2 })) } }] }, baseline.revisions as Record<string, number>)
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.clip.x.keyframes'])).properties).toMatchObject({ 'video_edit.clip.x.keyframes': points })
    expect((await app.read(effectRef, ['video_edit.effect.parameters.exposure.keyframes'])).properties).toMatchObject({ 'video_edit.effect.parameters.exposure.keyframes': points.map(point => ({ ...point, value: point.value * 2 })) })
    expect(videoEditClipValue(clip(), 'x', 15)).toBe(.25)
    const before = JSON.stringify(clip().curves)
    const nextBaseline = await app.read(ref)
    const rejected = await app.call('change_application_entities', { summary: '非法时刻', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.clip.x.keyframes': [{ time: 0, value: .8, interpolation: 'linear' }] } }, { kind: 'set_properties', entityType: effectRef.kind, target: effectRef, properties: { 'video_edit.effect.parameters.exposure.keyframes': [{ time: clip().duration, value: 1, interpolation: 'linear' }] } }] }, nextBaseline.revisions as Record<string, number>)
    expect(rejected.ok).toBe(false); expect(JSON.stringify(rejected)).toContain(`0–${clip().duration - 1}`)
    expect(JSON.stringify(clip().curves)).toBe(before)
    const invalidValue = await app.change(effectRef, { 'video_edit.effect.parameters.exposure.keyframes': [{ time: 0, value: 500, interpolation: 'ease' }] })
    expect(invalidValue.ok).toBe(false); expect(JSON.stringify(invalidValue)).toContain('曝光')
    const wheelPoints = points.map(point => ({ ...point, value: point.value * 60 }))
    const wheels = await app.change(effectRef, { 'video_edit.effect.parameters.shadow_hue.keyframes': wheelPoints })
    expect(wheels, JSON.stringify(wheels)).toMatchObject({ ok: true })
    const create = await app.call('change_application_entities', { summary: '新建动画曝光', changes: [{ kind: 'create_items', entityType: effectRef.kind, parent: ref, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:lumetri_color', 'video_edit.effect.parameters.exposure.keyframes': points } }] }] }, (await app.read(ref)).revisions as Record<string, number>)
    expect(create, JSON.stringify(create)).toMatchObject({ ok: true })
    expect(clip().effects?.at(-1)?.builtin?.curves?.exposure).toEqual(points)
    const shorter = await app.change(ref, { 'video_edit.clip.duration': 20 })
    expect(shorter, JSON.stringify(shorter)).toMatchObject({ ok: true })
    expect(clip().curves!.x!.at(-1)?.time).toBe(19)
    expect(clip().effects?.[0].builtin?.curves?.exposure.at(-1)?.time).toBe(19)
  } finally { app.dispose() }
})
