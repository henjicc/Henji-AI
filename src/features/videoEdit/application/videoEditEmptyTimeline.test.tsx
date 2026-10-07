// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditDocument, videoEditDocumentSchema, type VideoEditMedia } from '@/core/videoEdit/document'
import { VIDEO_EDIT_SEQUENCE_DEFAULTS } from '@/core/videoEdit/sequenceDefaults'
import { useSettingsStore } from '@/stores/settingsStore'
import { getPlatform } from '@/platform/runtime'
import { VideoEditEmptyTimeline } from '../panels/VideoEditEmptyTimeline'
import { VideoEditPreview } from '../VideoEditPreview'
import { VideoEditEffectsPanel } from '../panels/VideoEditEffectsPanel'
import { VideoEditLumetriPanel } from '../panels/VideoEditLumetriPanel'
import { VideoEditTrackingPanel } from '../panels/VideoEditTrackingPanel'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { VideoEditExportDialog } from '../panels/VideoEditExportDialog'
import { createHostContextSnapshot } from '@/features/application-control/hostContext/hostContext'
import { useNavigationStore } from '@/stores/navigationStore'
import { appendVideoEditMedia, appendVideoEditSequence, createVideoEditProject, deleteVideoEditSequence, findActiveVideoEditSequence, getActiveVideoEditSequence, setVideoEditProjectView, undoVideoEdit } from './videoEditService'
import { closeAllVideoEdits, reopenVideoEdit } from './videoEditDocumentTestKit'
import { dropVideoEditInput, VIDEO_EDIT_ITEM_DRAG_MIME } from './videoEditDrop'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from './videoEditCommands'

beforeEach(() => {
  installHarnessNativeStorage()
  useSettingsStore.getState().setVideoEditSequenceDefaults(structuredClone(VIDEO_EDIT_SEQUENCE_DEFAULTS))
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
})
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage(); useSettingsStore.getState().setVideoEditSequenceDefaults(structuredClone(VIDEO_EDIT_SEQUENCE_DEFAULTS)) })

it('新项目与保存重开允许零时间线，项目级命令仍可用，节目与效果面板正常显示空态', async () => {
  expect(videoEditDocumentSchema.parse(createVideoEditDocument('空项目')).sequences).toEqual([])
  const owner = await createVideoEditProject()
  expect(owner).toMatchObject({ activeSequenceId: '', openSequenceIds: [], selectedClipIds: [], targetTrackIds: [] })
  expect(findActiveVideoEditSequence(owner)).toBeUndefined()
  setVideoEditProjectView(owner.document.id, { selectedItemIds: [], openSequenceIds: [] })
  const context = captureVideoEditCommandContext(owner.document.id, 'timeline')
  expect(videoEditCommandState(context, 'export').enabled).toBe(false)
  expect(videoEditCommandState(context, 'split').enabled).toBe(false)
  expect(videoEditCommandState(context, 'save').enabled).toBe(true)
  await executeVideoEditCommand(context, 'save')
  const onError = vi.fn()
  const view = render(<><VideoEditTimeline instance={owner} onError={onError} /><VideoEditPreview instance={owner} onError={onError} /><VideoEditEffectsPanel instance={owner} onError={onError} /><VideoEditLumetriPanel instance={owner} onError={onError} /><VideoEditTrackingPanel instance={owner} onError={onError} /><VideoEditExportDialog projectId={owner.document.id} onClose={vi.fn()} /></>)
  expect(view.getAllByText('没有序列')).toHaveLength(4)
  expect(view.getByRole('button', { name: '新建序列' })).toBeTruthy()
  expect(view.getByRole('button', { name: '立即导出' })).toHaveProperty('disabled', true)
  useNavigationStore.setState({ activeWorkspace: 'videoEdit' })
  expect(createHostContextSnapshot().videoEdit?.sequenceRef).toBeNull()
  expect(onError).not.toHaveBeenCalled()
  cleanup()
  expect((await reopenVideoEdit(owner.document.id)).document.sequences).toEqual([])
})

it('空态按钮按内置默认新建，一步撤销；保存默认值后下一次新建使用已保存规格', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const view = render(<VideoEditEmptyTimeline instance={owner} onError={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: '新建序列' }))
  expect(view.getByLabelText('帧率')).toHaveProperty('value', '60/1')
  fireEvent.click(view.getByRole('button', { name: '确定' }))
  await waitFor(() => expect(owner.document.sequences).toHaveLength(1))
  expect(getActiveVideoEditSequence(owner)).toMatchObject({ width: 1920, height: 1080, fps: 60 })
  expect(owner.past).toHaveLength(1)
  act(() => undoVideoEdit(id))
  expect(owner.activeSequenceId).toBe(''); expect(owner.openSequenceIds).toEqual([])
  cleanup()
  const next = render(<VideoEditEmptyTimeline instance={owner} onError={vi.fn()} />)
  fireEvent.click(next.getByRole('button', { name: '新建序列' }))
  fireEvent.change(next.getByLabelText('宽度'), { target: { value: '1280' } })
  fireEvent.change(next.getByLabelText('高度'), { target: { value: '720' } })
  fireEvent.change(next.getByLabelText('帧率'), { target: { value: '24/1' } })
  fireEvent.click(next.getByRole('button', { name: '保存为默认值' }))
  fireEvent.click(next.getByRole('button', { name: '取消' }))
  fireEvent.click(next.getByRole('button', { name: '新建序列' }))
  expect(next.getByLabelText('宽度')).toHaveProperty('value', '1280')
  fireEvent.click(next.getByRole('button', { name: '确定' }))
  await waitFor(() => expect(owner.document.sequences).toHaveLength(1))
  expect(getActiveVideoEditSequence(owner)).toMatchObject({ width: 1280, height: 720, fps: 24 })
  expect(owner.past).toHaveLength(1)
})

const media = (kind: VideoEditMedia['kind'], patch: Partial<VideoEditMedia> = {}): VideoEditMedia => ({ id: crypto.randomUUID(), name: kind, kind, path: resolve('fixture', `${kind}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`), width: kind === 'audio' ? 0 : 1280, height: kind === 'audio' ? 0 : 720, durationSeconds: kind === 'image' ? 0 : 2, hasAudio: false, ...patch })

it.each(['video', 'image', 'audio'] as const)('零时间线拖入%s按首素材规格建时间线并放全部素材，整体一步撤销与重做', async kind => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  useSettingsStore.getState().setVideoEditSequenceDefaults({ ...VIDEO_EDIT_SEQUENCE_DEFAULTS, width: 640, height: 360, frameRate: { numerator: 24, denominator: 1 } })
  appendVideoEditMedia(id, media(kind, kind === 'video' ? { frameRate: { numerator: 25, denominator: 1 }, frameRateMode: 'sampled-constant' } : {}))
  appendVideoEditMedia(id, media('image', { name: '第二个素材', path: resolve('fixture', 'second.png') }))
  const itemIds = owner.document.items.map(item => item.id); const history = owner.past.length
  await dropVideoEditInput(id, { kind: 'items', projectId: id, itemIds }, { frame: 0 })
  expect(owner.document.sequences).toHaveLength(1)
  const sequence = getActiveVideoEditSequence(owner)
  expect(sequence).toMatchObject(kind === 'audio' ? { width: 640, height: 360, fps: 24 } : { width: 1280, height: 720, fps: kind === 'image' ? 60 : 25 })
  expect(sequence.clips.map(clip => clip.itemId)).toEqual(itemIds)
  expect(owner.selection).toBe(sequence.clips.at(-1)!.id)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document.sequences).toEqual([]); expect(owner.activeSequenceId).toBe('')
  undoVideoEdit(id, true); expect(getActiveVideoEditSequence(owner).clips).toHaveLength(2)
})

it.each(['paths', 'asset'] as const)('零时间线从%s导入图片后直接落位，导入和新建整体一步撤销', async source => {
  const owner = await createVideoEditProject(); const id = owner.document.id; const platform = getPlatform()
  const path = resolve('fixture', 'fresh.png')
  if (source === 'paths') {
    vi.spyOn(platform.system.fs, 'readDir').mockRejectedValue(new Error('文件'))
    vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(true)
    vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue(resolve('fixture'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array())))
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1280, height: 720, close: vi.fn() }))
  } else {
    const asset: AssetRecord = { id: 'fresh-image', mediaType: 'image', displayName: '原图', filePath: path, displayUrl: '', source: 'imported', mimeType: 'image/png', sizeBytes: 100, width: 1280, height: 720, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    vi.spyOn(platform.assetLibrary, 'inspectAsset').mockResolvedValue(asset)
  }
  await dropVideoEditInput(id, { kind: 'sources', sources: source === 'paths' ? [{ path }] : [{ assetId: 'fresh-image' }] }, { frame: 0 })
  expect(getActiveVideoEditSequence(owner)).toMatchObject({ width: 1280, height: 720, fps: 60, clips: [{ kind: 'image', start: 0 }] })
  expect(owner.past).toHaveLength(1)
  undoVideoEdit(id); expect(owner.document).toMatchObject({ media: [], items: [], sequences: [] })
})

it('保存的默认规格序列化到应用设置，重新读取仍使用保存值', async () => {
  const defaults = { ...VIDEO_EDIT_SEQUENCE_DEFAULTS, width: 1280, height: 720, frameRate: { numerator: 24, denominator: 1 } }
  useSettingsStore.getState().setVideoEditSequenceDefaults(defaults)
  const saved = localStorage.getItem('settings-storage')!
  expect(JSON.parse(saved).state.videoEditSequenceDefaults).toEqual(defaults)
  useSettingsStore.getState().setVideoEditSequenceDefaults(structuredClone(VIDEO_EDIT_SEQUENCE_DEFAULTS))
  localStorage.setItem('settings-storage', saved)
  await useSettingsStore.persist.rehydrate()
  expect(useSettingsStore.getState().videoEditSequenceDefaults).toEqual(defaults)
})

it('不可靠视频拖入通过现有规格面板确认，默认60帧且取消不写入时间线', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  appendVideoEditMedia(id, media('video', { frameRateMode: 'variable' }))
  const onError = vi.fn(); const view = render(<VideoEditEmptyTimeline instance={owner} onError={onError} />)
  const itemIds = owner.document.items.map(item => item.id)
  fireEvent.drop(view.getByRole('region'), { dataTransfer: { types: [VIDEO_EDIT_ITEM_DRAG_MIME], getData: () => JSON.stringify({ projectId: id, itemIds }) } })
  await waitFor(() => expect(view.getByRole('dialog')).toBeTruthy())
  expect(view.getByLabelText('帧率')).toHaveProperty('value', '60/1')
  fireEvent.click(view.getByRole('button', { name: '取消' })); expect(owner.document.sequences).toEqual([])
  fireEvent.drop(view.getByRole('region'), { dataTransfer: { types: [VIDEO_EDIT_ITEM_DRAG_MIME], getData: () => JSON.stringify({ projectId: id, itemIds }) } })
  await waitFor(() => expect(view.getByRole('dialog')).toBeTruthy())
  fireEvent.click(view.getByRole('button', { name: '确定' }))
  await waitFor(() => expect(owner.document.sequences).toHaveLength(1))
  expect(getActiveVideoEditSequence(owner).fps).toBe(60); expect(onError).not.toHaveBeenCalled()
})

it('通用实体读取没有序列、创建时间线使用应用默认，删除最后一条空序列后回到零条', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id; const app = createApplicationHarness()
  const ref = { kind: 'video_edit.document', id }
  const initial = await app.read(ref, ['video_edit.document.active_sequence_id']) as { properties: Record<string, unknown>; revisions: Record<string, number> }
  expect(initial.properties['video_edit.document.active_sequence_id']).toBe('')
  const result = await app.call('change_application_entities', { summary: '新建序列', changes: [{ kind: 'create_items', entityType: 'video_edit.sequence', parent: ref, items: [{ properties: { 'video_edit.sequence.name': '主时间线' } }] }] }, initial.revisions as Record<string, number>)
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  expect(getActiveVideoEditSequence(owner)).toMatchObject({ name: '主时间线', fps: 60 })
  const read = await app.read(ref, ['video_edit.document.active_sequence_id']) as { properties: Record<string, unknown>; revisions: Record<string, number> }
  expect(read.properties['video_edit.document.active_sequence_id']).toBe(owner.document.sequences[0].id)
  undoVideoEdit(id); expect(owner.document.sequences).toEqual([])
  const sequenceId = appendVideoEditSequence(id)
  deleteVideoEditSequence(id, sequenceId); expect(owner.activeSequenceId).toBe('')
  const defaults = { ...VIDEO_EDIT_SEQUENCE_DEFAULTS, width: 1280, height: 720 }
  const changed = await app.change({ kind: 'settings.registry', id: 'singleton' }, { 'video_edit.sequence_defaults': defaults })
  expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
  const settings = await app.read({ kind: 'settings.registry', id: 'singleton' }, ['video_edit.sequence_defaults']) as { properties: Record<string, unknown> }
  expect(settings.properties['video_edit.sequence_defaults']).toEqual(defaults)
  expect(useSettingsStore.getState().videoEditSequenceDefaults).toEqual(defaults)
  app.dispose()
})
