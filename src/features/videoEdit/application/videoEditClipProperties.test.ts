import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { useSettingsStore } from '@/stores/settingsStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { updateVideoEditClipProperties, videoEditClipPropertyBounds } from './videoEditClipProperties'
import { appendVideoEditClip, beginVideoEditGesture, closeVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, undoVideoEdit } from './videoEditService'

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/clip-properties.hjvid')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
})
afterEach(async () => {
  useSettingsStore.getState().setVideoEditSelectionFollowsPlayhead(false)
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})

async function project() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id)
  const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips[0]
  return { owner, id, sequenceId: sequence.id, clipId: clip.id }
}

it('一次拖动只记一步撤销：连续预览后撤销回到拖动前的值，取消则不进历史', async () => {
  const { owner, id, sequenceId, clipId } = await project()
  const volume = () => getActiveVideoEditSequence(owner).clips[0].volume
  const history = owner.past.length
  const drag = beginVideoEditGesture(id)
  for (const value of [1.1, 1.2, 1.3, 1.5]) updateVideoEditClipProperties(id, sequenceId, clipId, { volume: value }, drag)
  expect(volume()).toBe(1.5); expect(owner.past).toHaveLength(history)
  finishVideoEditGesture(drag)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(volume()).toBe(1)

  const cancelled = beginVideoEditGesture(id)
  updateVideoEditClipProperties(id, sequenceId, clipId, { volume: .4 }, cancelled)
  finishVideoEditGesture(cancelled, false)
  expect(volume()).toBe(1); expect(owner.past).toHaveLength(history)
})

it('数值按文档 schema 边界夹取，超范围输入不会变成校验错误', async () => {
  const { owner, id, sequenceId, clipId } = await project()
  expect(videoEditClipPropertyBounds('volume')).toEqual({ min: 0, max: 2 })
  expect(videoEditClipPropertyBounds('scale')).toEqual({ min: .01, max: 4 })
  updateVideoEditClipProperties(id, sequenceId, clipId, { volume: 7, opacity: -1, x: 9 })
  expect(getActiveVideoEditSequence(owner).clips[0]).toMatchObject({ volume: 2, opacity: 0, x: 2 })
  expect(() => updateVideoEditClipProperties(id, sequenceId, clipId, { rotation: Number.NaN })).toThrow('数值无效')
  expect(() => updateVideoEditClipProperties(id, sequenceId, clipId, { name: '  ' })).toThrow('名称不能为空')
})

it('播放头自动选中：开启后移动播放头选中最上面的可见片段，不进撤销历史；默认关闭', async () => {
  const { owner, id, clipId } = await project()
  const top = crypto.randomUUID()
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({
    ...sequence,
    tracks: [...sequence.tracks, { id: crypto.randomUUID(), name: '视频 2', index: 2, kind: 'video' as const, locked: false, enabled: true, muted: false, solo: false }],
    clips: [...sequence.clips.map(clip => ({ ...clip, start: 0, duration: 60 })), { ...sequence.clips[0], id: top, track: 2, start: 0, duration: 10 }],
  })) }))
  setVideoEditView(id, { selection: null })
  const history = owner.past.length
  setVideoEditView(id, { frame: 5 }); expect(owner.selection).toBeNull()

  useSettingsStore.getState().setVideoEditSelectionFollowsPlayhead(true)
  setVideoEditView(id, { frame: 6 }); expect(owner.selection).toBe(top)
  setVideoEditView(id, { frame: 30 }); expect(owner.selection).toBe(clipId)
  setVideoEditView(id, { frame: 90 }); expect(owner.selection).toBeNull()
  setVideoEditView(id, { frame: 3, selection: clipId }); expect(owner.selection).toBe(clipId)

  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, tracks: sequence.tracks.map(track => track.index === 2 ? { ...track, enabled: false } : track) })) }))
  const afterHide = owner.past.length
  setVideoEditView(id, { frame: 4 }); expect(owner.selection).toBe(clipId)

  const drag = beginVideoEditGesture(id)
  setVideoEditView(id, { frame: 80 }); expect(owner.selection).toBe(clipId)
  finishVideoEditGesture(drag, false)
  expect(owner.past).toHaveLength(afterHide); expect(afterHide).toBe(history + 1)
})

it('片段备注：写入去掉首尾空白、保留换行，清空即删除字段，每次一步撤销', async () => {
  const { owner, id, sequenceId, clipId } = await project()
  const clip = () => getActiveVideoEditSequence(owner).clips[0]
  updateVideoEditClipProperties(id, sequenceId, clipId, { note: '  开头说快了\n01:28 起重录  ' })
  expect(clip().note).toBe('开头说快了\n01:28 起重录')
  updateVideoEditClipProperties(id, sequenceId, clipId, { note: '   ' })
  expect(clip()).not.toHaveProperty('note')
  undoVideoEdit(id); expect(clip().note).toBe('开头说快了\n01:28 起重录')
  undoVideoEdit(id); expect(clip()).not.toHaveProperty('note')
})

it('助手经通用属性读写片段备注：没有备注读成空字符串，写空字符串删除，可撤销', async () => {
  const { owner, id, clipId } = await project()
  const app = createApplicationHarness(); const ref = { kind: 'video_edit.clip', id: `${id}:${clipId}` }
  try {
    expect((await app.read(ref, ['video_edit.clip.note'])).properties).toEqual({ 'video_edit.clip.note': '' })
    expect((await app.change(ref, { 'video_edit.clip.note': '给后期：这段节奏偏慢' })).ok).toBe(true)
    expect(getActiveVideoEditSequence(owner).clips[0].note).toBe('给后期：这段节奏偏慢')
    expect((await app.read(ref, ['video_edit.clip.note'])).properties).toEqual({ 'video_edit.clip.note': '给后期：这段节奏偏慢' })
    expect((await app.change(ref, { 'video_edit.clip.note': '' })).ok).toBe(true)
    expect(getActiveVideoEditSequence(owner).clips[0]).not.toHaveProperty('note')
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].note).toBe('给后期：这段节奏偏慢')
  } finally { app.dispose() }
})
