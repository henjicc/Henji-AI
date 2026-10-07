import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditClip, appendVideoEditMedia, appendVideoEditSequence, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, getVideoEditTimelineView, listVideoEditInstances, saveVideoEdit, setVideoEditTimelineView, setVideoEditView, subscribeVideoEdit, switchVideoEditSequence, undoVideoEdit } from './videoEditService'
import { beginVideoEditTimelineDrag, copyVideoEditTimeline, executeVideoEditTimelineEdit, finishVideoEditTimelineDrag, previewVideoEditTimelineDrag, readVideoEditClipboard, separateVideoEditAudio, updateVideoEditTrack } from './videoEditTimeline'
import * as mediaService from './videoEditMedia'
import { VideoEditMutationExecutor } from './videoEditExecutors'
import type { ApplicationPlannedStep } from '@/core/application-control'
import { useSettingsStore } from '@/stores/settingsStore'
import { dropVideoEditInput } from './videoEditDrop'
import { savedVideoEdit, reopenVideoEdit } from './videoEditDocumentTestKit'

const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  const platform = getPlatform()
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/fixture/timeline.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockImplementation(async (path, content) => { files.set(path, content) })
  vi.spyOn(platform.system.fs, 'readTextFile').mockImplementation(async path => { const value = files.get(path); if (!value) throw new Error('missing'); return value })
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/fixture')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); appendVideoEditClip(id)
  editVideoProject(id, document => { document.sequences[0].clips[1].start = 200; return document })
  const sequence = getActiveVideoEditSequence(owner); const ids = sequence.clips.map(clip => clip.id)
  setVideoEditTimelineView(id, { selectedClipIds: ids })
  return { owner, id, sequence, ids }
}
it('节目拖入依真实32轨目标和素材类型落点，显式锁定落轨拒绝整个编辑', async () => {
  const { owner, id } = await fixture()
  appendVideoEditMedia(id, { id: 'sound', name: '原声音', path: 'D:/original.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 2 })
  editVideoProject(id, document => { document.sequences[0].tracks.push({ id: 'track-31', name: '视频 31', index: 31, kind: 'video', locked: false, enabled: true, muted: false, solo: false }); return document })
  const sequence = getActiveVideoEditSequence(owner); const audioItem = owner.document.items.find(item => item.kind === 'audio')!; const textItem = owner.document.items.find(item => item.kind === 'text')!
  setVideoEditTimelineView(id, { targetTrackIds: ['track-31', sequence.tracks[0].id] })
  await dropVideoEditInput(id, { kind: 'items', projectId: id, itemIds: [textItem.id, audioItem.id] }, { frame: 400 })
  expect(getActiveVideoEditSequence(owner).clips.slice(-2).map(clip => [clip.kind, clip.track])).toEqual([['text', 31], ['audio', 0]])
  updateVideoEditTrack(id, sequence.id, 'track-31', { locked: true }); const before = owner.document
  await expect(dropVideoEditInput(id, { kind: 'items', projectId: id, itemIds: [textItem.id] }, { frame: 700 })).rejects.toThrow('锁定')
  expect(owner.document).toBe(before)
})
it('正式设置反射读写封闭键位对象，冲突写入保留原配置', async () => {
  await fixture(); const app = createApplicationHarness(); useSettingsStore.getState().setVideoEditShortcuts({})
  const ref = { kind: 'settings.registry', id: 'singleton' }; const config = { select_tool: { code: 'F9', ctrl: false, meta: false, alt: false, shift: false } }
  try {
    expect((await app.change(ref, { 'video_edit.shortcuts': config })).ok).toBe(true)
    expect((await app.read(ref, ['video_edit.shortcuts'])).properties).toEqual({ 'video_edit.shortcuts': config })
    expect((await app.change(ref, { 'video_edit.shortcuts': { select_tool: { ...config.select_tool, code: 'KeyC' } } })).ok).toBe(false)
    expect(useSettingsStore.getState().videoEditShortcuts).toEqual(config)
  } finally { useSettingsStore.getState().setVideoEditShortcuts({}); app.dispose() }
})
it('时间线与节目公共视图沿原会话回读，实际逐帧观察不妨碍逆序补偿', async () => {
  const { owner, id, ids } = await fixture(); const app = createApplicationHarness(); const baseline = getVideoEditTimelineView(id); const history = owner.past.length
  const ref = { kind: 'video_edit.document', id }
  try {
    const result = await app.change(ref, { 'video_edit.document.timeline_view': { ...baseline, selectedClipIds: [ids[0]], tool: 'razor', inFrame: 3, outFrame: 30 } })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.document.timeline_view'])).properties).toMatchObject({ 'video_edit.document.timeline_view': { selectedClipIds: [ids[0]], tool: 'razor' } })
    expect(owner.past.length).toBe(history)
    const executor = new VideoEditMutationExecutor('video_edit.document')
    const step = (frame: number): Extract<ApplicationPlannedStep, { kind: 'mutation' }> => ({ kind: 'mutation', entityType: ref.kind, target: ref, expectedRevisions: {}, mutations: [{ propertyId: 'video_edit.document.program_playback', operation: 'set', value: { frame, playing: true, playbackDirection: -1 } }] })
    const first = await executor.apply(step(50)); const second = await executor.apply(step(60))
    setVideoEditView(id, { frame: 55 }, true)
    await executor.undo(second.undoToken!); expect(owner.frame).toBe(50)
    await executor.undo(first.undoToken!); expect(owner.frame).toBe(0); expect(owner.playing).toBe(false)
    const stale = await executor.apply(step(50)); setVideoEditView(id, { frame: 70 })
    await expect(executor.undo(stale.undoToken!)).rejects.toThrow('后续修改')
    expect(owner.frame).toBe(70); expect(owner.past.length).toBe(history)
    const before = owner.document.name
    expect((await app.change(ref, { 'video_edit.document.name': '不可半改', 'video_edit.document.timeline_view': { ...baseline, selectedClipIds: ['missing'] } })).ok).toBe(false)
    expect(owner.document.name).toBe(before)
    expect((await app.change(ref, { 'video_edit.document.name': '不可超范围半改', 'video_edit.document.program_playback': { frame: 54001, playing: false, playbackDirection: 1 } })).ok).toBe(false)
    expect(owner.document.name).toBe(before); expect(owner.frame).toBe(70)
    const fresh = await executor.apply(step(50))
    const secondSequence = appendVideoEditSequence(id)
    // Use a new receipt after persistent creation; only the A -> B -> A view change invalidates it.
    const current = await executor.apply(step(60))
    const firstSequence = owner.activeSequenceId
    switchVideoEditSequence(id, secondSequence); switchVideoEditSequence(id, firstSequence)
    await expect(executor.undo(current.undoToken!)).rejects.toThrow('后续修改')
    expect(owner.frame).toBe(60); expect(fresh.undoToken).toBeTruthy()
  } finally { app.dispose() }
})
it('插入/覆盖后删除只删除放入的片段，原片段左右尾部保持', async () => {
  const { owner, id, sequence, ids } = await fixture()
  copyVideoEditTimeline(id, sequence.id, [ids[1]])
  const clipboard = readVideoEditClipboard(id)!; clipboard.clips[0].duration = 10
  for (const mode of ['insert', 'overwrite'] as const) {
    const baseline = owner.document
    executeVideoEditTimelineEdit(id, sequence.id, { kind: 'place', clipboard, frame: 40, mode })
    expect(owner.selectedClipIds).toHaveLength(1)
    executeVideoEditTimelineEdit(id, sequence.id, { kind: 'delete', clipIds: owner.selectedClipIds })
    expect(getActiveVideoEditSequence(owner).clips.some(clip => clip.start === 50)).toBe(true)
    undoVideoEdit(id); undoVideoEdit(id)
    expect(JSON.stringify({ ...owner.document, revision: 0 })).toBe(JSON.stringify({ ...baseline, revision: 0 }))
  }
})
it('多选/工具/目标/范围按真实序列保存视图，兼容selection投影且时间位置不入剪辑历史', async () => {
  const { owner, id, ids, sequence } = await fixture(); const history = owner.past.length
  setVideoEditTimelineView(id, { tool: 'razor', targetTrackIds: [sequence.tracks[1].id], inFrame: 2, outFrame: 50, zoom: 2 })
  const before = getVideoEditTimelineView(id)
  expect(owner.selection).toBe(ids[1]); expect(owner.selectedClipIds).toEqual(ids)
  const second = appendVideoEditSequence(id)
  switchVideoEditSequence(id, second); expect(owner.selectedClipIds).toEqual([]); expect(owner.tool).toBe('select')
  switchVideoEditSequence(id, sequence.id); expect(getVideoEditTimelineView(id)).toEqual(before)
  expect(owner.past.length).toBe(history + 1)
  const valid = getVideoEditTimelineView(id)
  expect(() => setVideoEditTimelineView(id, { selectedClipIds: ['foreign'] })).toThrow('序列')
  expect(() => setVideoEditView(id, { selection: 'foreign' })).toThrow('序列')
  expect(getVideoEditTimelineView(id)).toEqual(valid); expect(owner.selection).toBe(ids[1])
})
it('64次指针预览不改剪辑/保存/历史，释放只提交一次且可撤销', async () => {
  const { owner, id, sequence } = await fixture(); await saveVideoEdit(id)
  const baseline = owner.document; const past = owner.past.length; const saved = JSON.stringify(savedVideoEdit(owner))
  const handle = beginVideoEditTimelineDrag(id, sequence.id)
  for (let index = 0; index < 64; index++) expect(previewVideoEditTimelineDrag(handle, { mode: 'move', delta: index }).clips[0].start).toBe(index)
  expect(owner.document).toBe(baseline); expect(owner.past.length).toBe(past); expect(owner.dirty).toBe(false); expect(JSON.stringify(savedVideoEdit(owner))).toBe(saved)
  finishVideoEditTimelineDrag(handle, { mode: 'move', delta: 20 })
  expect(owner.past.length).toBe(past + 1); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.start)).toEqual([20, 220])
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.start)).toEqual([0, 200])
  expect(() => previewVideoEditTimelineDrag(handle, { mode: 'move', delta: 1 })).toThrow('改变')
})
it('切换序列/选区/关闭重开后晚到释放不能修改新的目标', async () => {
  const { owner, id, ids, sequence } = await fixture()
  let handle = beginVideoEditTimelineDrag(id, sequence.id)
  const second = appendVideoEditSequence(id); switchVideoEditSequence(id, second)
  expect(() => finishVideoEditTimelineDrag(handle, { mode: 'move', delta: 2 })).toThrow('改变')
  switchVideoEditSequence(id, sequence.id); handle = beginVideoEditTimelineDrag(id, sequence.id)
  setVideoEditTimelineView(id, { selectedClipIds: [ids[0]] })
  expect(() => finishVideoEditTimelineDrag(handle, { mode: 'move', delta: 2 })).toThrow('改变')
  handle = beginVideoEditTimelineDrag(id, sequence.id); await saveVideoEdit(id); await closeVideoEditProject(id)
  await reopenVideoEdit(owner.document.id)
  expect(() => finishVideoEditTimelineDrag(handle, { mode: 'move', delta: 2 })).toThrow('改变')
})
it('领域锁定覆盖手动、公共字段与拖动入口，通用事务失败完整恢复锁和片段', async () => {
  const { owner, id, ids, sequence } = await fixture()
  const track = sequence.tracks[1]; const ref = { kind: 'video_edit.clip', id: `${id}:${ids[0]}` }; const trackRef = { kind: 'video_edit.track', id: `${id}:${track.id}` }
  updateVideoEditTrack(id, sequence.id, track.id, { locked: true })
  const history = owner.past.length
  expect(() => executeVideoEditTimelineEdit(id, sequence.id, { kind: 'delete', clipIds: ids })).toThrow('锁定')
  const app = createApplicationHarness()
  try {
    const result = await app.change(ref, { 'video_edit.clip.x': .2 })
    expect(result.ok).toBe(false); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0); expect(owner.past.length).toBe(history)
    expect((await app.read(trackRef, ['video_edit.track.height', 'video_edit.track.sync_locked'])).properties).toMatchObject({ 'video_edit.track.height': 32, 'video_edit.track.sync_locked': true })
    updateVideoEditTrack(id, sequence.id, track.id, { locked: false })
    const baseline = await app.read(ref); const past = owner.past.length
    let lockedIntermediate = false
    const unsubscribe = subscribeVideoEdit(() => { if (getActiveVideoEditSequence(owner).tracks[1].locked && getActiveVideoEditSequence(owner).clips[0].x === .2) lockedIntermediate = true })
    const failed = await app.call('change_application_entities', { summary: '验证锁定失败回滚', changes: [
      { kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.clip.x': .2 } },
      { kind: 'set_properties', entityType: trackRef.kind, target: trackRef, properties: { 'video_edit.track.locked': true } },
      { kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.clip.x': .3 } },
    ] }, baseline.revisions as Record<string, number>)
    unsubscribe(); expect(lockedIntermediate).toBe(true)
    expect(failed.ok).toBe(false); expect(JSON.stringify(failed)).toContain('锁定'); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0); expect(getActiveVideoEditSequence(owner).tracks[1].locked).toBe(false); expect(owner.past.length).toBe(past)
  } finally { app.dispose() }
})
it('关联清除与声音分量通过同源属性/集合创建回读，保存重开保持原引用', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'media', name: '原视频', path: 'D:/original.mp4', kind: 'video', width: 320, height: 180, durationSeconds: 3, hasAudio: true })
  const item = owner.document.items[0]; const app = createApplicationHarness()
  try {
    const parent = { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }; const baseline = await app.read(parent)
    const created = await app.call('change_application_entities', { summary: '引用原视频声音', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent, items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.name': '声音', 'video_edit.clip.kind': 'audio', 'video_edit.clip.source_component': 'audio', 'video_edit.clip.track': 0, 'video_edit.clip.link_id': 'pair' } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const clip = getActiveVideoEditSequence(owner).clips[0]; const ref = { kind: 'video_edit.clip', id: `${id}:${clip.id}` }
    expect(clip).toMatchObject({ kind: 'audio', itemId: item.id, sourceComponent: 'audio', track: 0 })
    expect((await app.change(ref, { 'video_edit.clip.link_id': '' })).ok).toBe(true)
    expect((await app.read(ref, ['video_edit.clip.link_id', 'video_edit.clip.source_component'])).properties).toMatchObject({ 'video_edit.clip.link_id': '', 'video_edit.clip.source_component': 'audio' })
    await saveVideoEdit(id); await closeVideoEditProject(id)
    const reopened = await reopenVideoEdit(owner.document.id)
    expect(reopened.document.media).toHaveLength(1); expect(reopened.document.items).toHaveLength(1); expect(getActiveVideoEditSequence(reopened).clips[0].sourceComponent).toBe('audio')
  } finally { app.dispose() }
})
it('公共创建按显式源入点和短时长引用长视频，不把整段源时长当作节目边界', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'long-media', name: '长原视频', path: 'D:/original-long.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 3600 })
  const item = owner.document.items[0]; const app = createApplicationHarness()
  try {
    const parent = { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }; const baseline = await app.read(parent)
    const created = await app.call('change_application_entities', { summary: '长源短片段', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent, items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.kind': 'video', 'video_edit.clip.name': '长源短片段', 'video_edit.clip.start': 53900, 'video_edit.clip.duration': 30, 'video_edit.clip.source_in_us': 3_500_000_000, 'video_edit.clip.track': 1 } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips[0]).toMatchObject({ itemId: item.id, start: 53900, duration: 30, sourceInUs: 3_500_000_000 })
    expect(owner.document.media[0].path).toBe('D:/original-long.mp4')
  } finally { app.dispose() }
})
it('旧剪辑拆音先检测真实音轨，检查期间文档变化/无音轨均不产生半个编辑', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'media', name: '视频', path: 'D:/original.mp4', kind: 'video', width: 320, height: 180, durationSeconds: 3 })
  appendVideoEditClip(id, owner.document.media[0].id)
  const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips[0]; const past = owner.past.length
  const inspect = vi.spyOn(mediaService, 'inspectVideoEditMedia').mockResolvedValue({ ...owner.document.media[0], hasAudio: false })
  await expect(separateVideoEditAudio(id, sequence.id, [clip.id], 0)).rejects.toThrow('音轨')
  expect(owner.past.length).toBe(past); expect(getActiveVideoEditSequence(owner).clips).toHaveLength(1)
  let release!: (value: typeof owner.document.media[number]) => void
  inspect.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = separateVideoEditAudio(id, sequence.id, [clip.id], 0)
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '新编辑' }) })); release({ ...owner.document.media[0], hasAudio: true })
  await expect(pending).rejects.toThrow('已改变'); expect(getActiveVideoEditSequence(owner).clips).toHaveLength(1)
  inspect.mockResolvedValue({ ...owner.document.media[0], hasAudio: true })
  const before = owner.past.length; await separateVideoEditAudio(id, sequence.id, [clip.id], 0)
  expect(owner.past.length).toBe(before + 1); expect(getActiveVideoEditSequence(owner).clips).toHaveLength(2); expect(owner.document.media[0].hasAudio).toBe(true)
  copyVideoEditTimeline(id, sequence.id); expect(readVideoEditClipboard(id)?.clips).toHaveLength(2)
})
it('助手修剪能力与时间线修剪工具同一份编辑：链接音画一起波纹修剪与外滑，做不到时说明边界不写历史', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'media', name: '原视频', path: 'D:/original.mp4', kind: 'video', width: 320, height: 180, durationSeconds: 3, hasAudio: true })
  appendVideoEditClip(id, 'media'); const sequence = getActiveVideoEditSequence(owner)
  await separateVideoEditAudio(id, sequence.id, [sequence.clips[0].id], 0)
  const [picture] = getActiveVideoEditSequence(owner).clips.map(clip => clip.id)
  const app = createApplicationHarness(); const documentRef = { kind: 'video_edit.document', id }; const clipRef = { kind: 'video_edit.clip', id: `${id}:${picture}` }
  try {
    // 整段素材都用上了：外滑没有余量
    const past = owner.past.length
    expect((await app.call('trim_video_edit_clip', { documentRef, clipRef, mode: 'slip', frames: 10 })).ok).toBe(false); expect(owner.past.length).toBe(past)
    expect((await app.call('trim_video_edit_clip', { documentRef, clipRef, mode: 'ripple', frames: -30 })).ok).toBe(false)
    const ripple = await app.requireResult('trim_video_edit_clip', { documentRef, clipRef, mode: 'ripple', edge: 'out', frames: -30 }) as { message: string }
    expect(ripple.message).toContain('-30'); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.duration)).toEqual([60, 60])
    const slip = await app.requireResult('trim_video_edit_clip', { documentRef, clipRef, mode: 'slip', frames: 100 }) as { message: string }
    expect(slip.message).toContain('请求 100 帧'); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.sourceInUs)).toEqual([1_000_000, 1_000_000])
    expect(owner.past.length).toBe(past + 2)
  } finally { app.dispose() }
})
it('助手经时间线视图读写链接选择；拆分能力与剃刀同语义，选区写入按原样保存不再扩展', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'media', name: '原视频', path: 'D:/original.mp4', kind: 'video', width: 320, height: 180, durationSeconds: 3, hasAudio: true })
  appendVideoEditClip(id, 'media'); const sequence = getActiveVideoEditSequence(owner)
  await separateVideoEditAudio(id, sequence.id, [sequence.clips[0].id], 0)
  const [picture, sound] = getActiveVideoEditSequence(owner).clips.map(clip => clip.id)
  expect(new Set(owner.selectedClipIds)).toEqual(new Set([picture, sound]))
  const app = createApplicationHarness(); const projectRef = { kind: 'video_edit.document', id }
  try {
    expect((await app.read(projectRef, ['video_edit.document.timeline_view']) as { properties: Record<string, unknown> }).properties['video_edit.document.timeline_view']).toMatchObject({ linkedSelection: true })
    expect((await app.change(projectRef, { 'video_edit.document.timeline_view': { ...getVideoEditTimelineView(id), selectedClipIds: [sound], linkedSelection: false } })).ok).toBe(true)
    expect(owner.selectedClipIds).toEqual([sound]); expect(owner.linkedSelection).toBe(false)
    const clipRef = (clipId: string) => ({ kind: 'video_edit.clip', id: `${id}:${clipId}` })
    await app.requireResult('split_video_edit', { documentRef: projectRef, clipRef: clipRef(picture), frame: 30 })
    expect(getActiveVideoEditSequence(owner).clips).toHaveLength(3)
    expect(new Set(getActiveVideoEditSequence(owner).clips.map(clip => clip.linkId)).size).toBe(1)
    setVideoEditTimelineView(id, { linkedSelection: true })
    await app.requireResult('split_video_edit', { documentRef: projectRef, clipRef: clipRef(picture), frame: 15 })
    const clips = getActiveVideoEditSequence(owner).clips
    expect(clips).toHaveLength(5)
    expect(clips.filter(clip => clip.start === 15).map(clip => clip.kind).sort()).toEqual(['audio', 'video'])
    expect(new Set(clips.filter(clip => clip.start === 15).map(clip => clip.linkId)).size).toBe(1)
  } finally { app.dispose() }
})
