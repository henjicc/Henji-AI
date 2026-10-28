// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { closeAllVideoEdits, createVideoEditTestProject } from './videoEditDocumentTestKit'
import { editVideoProject, focusVideoEditPanel, setVideoEditTimelineView, setVideoEditView, type VideoEditInstance } from './videoEditService'
import { selectedVideoEditSubtitleId, selectVideoEditSubtitle } from './videoEditSubtitleSelection'
import { focusApplicationEntity } from '@/features/navigation/application/surfaceCapabilityService'

beforeEach(installHarnessNativeStorage)
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

async function captionProject(): Promise<VideoEditInstance> {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  editVideoProject(id, document => {
    document.items = [{ id: 'text-item', kind: 'text', name: '文字素材项' }]
    document.sequences[0].clips = [{ ...makeVideoEditItemClip(document, 'text-item', document.sequences[0].id, { frame: 0, track: 1 }), id: 'clip', duration: 90 }]
    document.sequences[0].captions = [{ id: 'one', text: '第一句', start: 12, duration: 30, clipId: 'clip' }]
    return document
  })
  return owner
}

it('时间线上选中字幕：效果控件到前面、片段选择清空、播放头跳到它；列表里选中留在原面板，选片段即取消字幕选择（重要记录 019）', async () => {
  const owner = await captionProject(); const id = owner.document.id
  setVideoEditTimelineView(id, { selectedClipIds: ['clip'] }, 'clip')
  focusVideoEditPanel(id, 'content')
  const version = owner.panelFocusVersion ?? 0
  selectVideoEditSubtitle(id, owner.activeSequenceId, 'one')
  expect(owner.activePanel).toBe('effects'); expect(owner.panelFocusVersion).toBe(version + 1)
  expect(owner.selectedClipIds).toEqual([]); expect(owner.selection).toBeNull()
  expect(owner.frame).toBe(12); expect(selectedVideoEditSubtitleId(owner)).toBe('one')
  focusVideoEditPanel(id, 'content')
  selectVideoEditSubtitle(id, owner.activeSequenceId, 'one', { reveal: false })
  expect(owner.activePanel).toBe('content')
  setVideoEditTimelineView(id, { selectedClipIds: ['clip'] }, 'clip')
  expect(selectedVideoEditSubtitleId(owner)).toBeUndefined()
})

it('助手定位字幕与人走同一条选择：选中字幕、清空片段选择、效果控件到前面', async () => {
  const owner = await captionProject(); const id = owner.document.id
  setVideoEditTimelineView(id, { selectedClipIds: ['clip'] }, 'clip')
  focusVideoEditPanel(id, 'content')
  await focusApplicationEntity({ kind: 'video_edit.caption', id: `${id}:one` }, new AbortController().signal)
  expect(selectedVideoEditSubtitleId(owner)).toBe('one'); expect(owner.selectedClipIds).toEqual([])
  expect(owner.frame).toBe(12); expect(owner.activePanel).toBe('effects')
})

it('选中片段时字幕选择被清掉，之后清空片段选择它也不会回来（不会被 Delete 误删）', async () => {
  const owner = await captionProject(); const id = owner.document.id
  selectVideoEditSubtitle(id, owner.activeSequenceId, 'one')
  setVideoEditView(id, { selection: 'clip' })
  expect(owner.selectedCaptionId).toBeNull()
  setVideoEditTimelineView(id, { selectedClipIds: [] })
  expect(selectedVideoEditSubtitleId(owner)).toBeUndefined(); expect(owner.selectedCaptionId).toBeNull()
})
