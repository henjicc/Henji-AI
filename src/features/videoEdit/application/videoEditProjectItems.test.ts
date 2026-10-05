// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditProject, appendVideoEditMedia, listVideoEditInstances, closeVideoEditProject, getActiveVideoEditSequence, undoVideoEdit, saveVideoEdit, openVideoEditProject, setVideoEditView, getVideoEditProjectView, setVideoEditProjectView, appendVideoEditSequence } from './videoEditService'
import { createVideoEditBin, updateVideoEditItems, appendVideoEditItems, createVideoEditSequenceFromItem, deleteVideoEditItems, deleteVideoEditBins, createVideoEditGraphicItem, createVideoEditAdjustmentItem } from './videoEditProjectItems'
import { importVideoEditSources, relinkVideoEditMedia } from './videoEditMedia'
import { dropVideoEditInput } from './videoEditDrop'
import { VideoEditMutationExecutor, VideoEditCollectionExecutor } from './videoEditExecutors'
import type { ApplicationPlannedStep } from '@/core/application-control'
import { readVideoEditSource, updateVideoEditSource, registerVideoEditSourcePresenter } from './videoEditSource'
import { editVideoSequence, editVideoProject } from './videoEditService'
import { savedVideoEdit, reopenVideoEdit } from './videoEditDocumentTestKit'
const files = new Map<string, string>()
it('原生项目项使用真实图形、素材箱与历史，调整层默认选择有下方画面的轨道', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const sequenceId = owner.activeSequenceId
  editVideoSequence(id, sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.filter(track => track.index <= 1) }))
  const { width, height } = getActiveVideoEditSequence(owner)
  const binId = createVideoEditBin(id, '图形'); const history = owner.past.length
  const graphicId = createVideoEditGraphicItem(id, { kind: 'solid', name: '背景', binId })
  expect(owner.past).toHaveLength(history + 1)
  const item = owner.document.items.find(item => item.id === graphicId)!
  expect(item).toMatchObject({ kind: 'graphic', binId, graphic: { width, height, objects: [{ kind: 'rect', parameters: { x: 0, y: 0, width, height } }] } })
  const [clipId] = appendVideoEditItems(id, [graphicId], sequenceId, { frame: 0 })
  const clip = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === clipId)!
  expect(clip.graphic).toEqual(item.graphic); expect(clip.graphic).not.toBe(item.graphic)
  const adjustmentId = createVideoEditAdjustmentItem(id, { binId }); const stable = owner.document; const past = owner.past.length
  expect(() => appendVideoEditItems(id, [adjustmentId], sequenceId)).toThrow('上方')
  expect(() => createVideoEditGraphicItem(id, { kind: 'rect', width: 0 })).toThrow()
  expect(() => createVideoEditGraphicItem(id, { kind: 'rect', binId: 'missing' })).toThrow()
  expect(owner.document).toBe(stable); expect(owner.past).toHaveLength(past)
  editVideoSequence(id, sequenceId, sequence => ({ ...sequence, tracks: [...sequence.tracks, { ...sequence.tracks.find(track => track.kind === 'video')!, id: 'upper', index: 2, name: '上方画面' }] }))
  appendVideoEditItems(id, [adjustmentId], sequenceId, { frame: 0 })
  expect(getActiveVideoEditSequence(owner).clips.at(-1)).toMatchObject({ kind: 'adjustment', track: 2, adjustment: { fromTrack: 1 }, volume: 0 })
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.id)).toEqual([clipId])
  await saveVideoEdit(id); const reopened = await reopenVideoEdit(owner.document.id)
  expect(reopened.document.items.find(item => item.id === graphicId)?.graphic).toEqual(item.graphic)
})
it('公共移除项目项与手动删除同样清除孤儿媒体，并以声明级联撤销恢复', async () => {
  const instance = (await createVideoEditProject())!; const id = instance.document.id
  appendVideoEditMedia(id, { id: 'unused-media', name: '原图', path: 'D:/media/original.png', kind: 'image', width: 10, height: 10, durationSeconds: 0 })
  const executor = new VideoEditCollectionExecutor('video_edit.item')
  const result = await executor.apply({ kind: 'collection', entityType: executor.entityType, parent: { kind: 'video_edit.project', id }, expectedRevisions: {}, operation: { kind: 'remove', targets: [{ kind: 'video_edit.item', id: `${id}:${instance.document.items[0].id}` }] } })
  expect(instance.document.items).toEqual([]); expect(instance.document.media).toEqual([])
  expect(result.cascadeEffects).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'video_edit.media', effect: 'delete', origin: { kind: 'cascade', declarationId: 'video_edit.item_media_delete' } })]))
  const restored = await executor.undo(result.undoToken!)
  expect(instance.document.media).toHaveLength(1); expect(instance.document.items).toHaveLength(1)
  expect(restored.cascadeEffects).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'video_edit.media', effect: 'create', origin: { kind: 'cascade', declarationId: 'video_edit.item_media_create' } })]))
})
beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { const width = text.length * Number.parseFloat(this.font); return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width } } } } })
  installHarnessNativeStorage(); files.clear()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/project-items.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/media')
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
})
afterEach(async () => { for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
async function fixture() {
  const instance = (await createVideoEditProject())!
  appendVideoEditMedia(instance.document.id, { id: 'source-video', name: '4k original', path: 'D:/media/original.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 3, frameRate: { numerator: 60000, denominator: 1001 }, frameRateMode: 'sampled-constant' })
  return instance
}
it('同路径在不同箱内保留不同项目项及资产身份，拖入按指定项目项引用', async () => {
  const instance = await fixture(); const id = instance.document.id
  vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue({ id: 'asset-original', mediaType: 'video', displayName: '原片', filePath: 'D:/media/original.mp4', displayUrl: '', source: 'imported', mimeType: 'video/mp4', sizeBytes: 4096, width: 3840, height: 2160, durationSeconds: 3, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] })
  editVideoProject(id, document => ({ ...document, media: document.media.map(media => ({ ...media, assetId: 'asset-original', assetContent: { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) } })) }))
  const bin = createVideoEditBin(id, '第二个素材箱')
  const ids = await importVideoEditSources(id, [{ path: 'd:\\media\\original.mp4', assetId: 'asset-original' }], bin)
  expect(instance.document.media).toHaveLength(1); expect(instance.document.media[0].assetId).toBe('asset-original')
  expect(instance.document.items).toHaveLength(2)
  updateVideoEditItems(id, ids, { name: '选定项目项', tags: ['片头'] })
  const history = instance.past.length
  await dropVideoEditInput(id, { kind: 'items', projectId: id, itemIds: ids }, { frame: 12, track: 1 })
  expect(getActiveVideoEditSequence(instance).clips[0]).toMatchObject({ itemId: ids[0], name: '选定项目项', start: 12 })
  expect(instance.past).toHaveLength(history + 1)
  expect(() => deleteVideoEditItems(id, ids)).toThrow('仍被序列')
  expect(() => deleteVideoEditBins(id, [bin])).toThrow('仍有内容')
  undoVideoEdit(id); deleteVideoEditItems(id, ids); deleteVideoEditBins(id, [bin])
  expect(instance.document.media[0].path).toBe('D:/media/original.mp4')
})
it('按素材建序列与插入是一步撤销并持久保存有理帧率，未知或可变帧率要求选择', async () => {
  const instance = await fixture(); const id = instance.document.id; const item = instance.document.items[0]
  const before = instance.past.length
  const sequenceId = createVideoEditSequenceFromItem(id, item.id)
  expect(instance.past).toHaveLength(before + 1)
  expect(getActiveVideoEditSequence(instance)).toMatchObject({ id: sequenceId, width: 3840, height: 2160, frameRate: { numerator: 60000, denominator: 1001 } })
  expect(getActiveVideoEditSequence(instance).clips[0].itemId).toBe(item.id)
  await saveVideoEdit(id); await closeVideoEditProject(id)
  const reopened = await reopenVideoEdit(instance.document.id)
  expect(reopened.document.sequences[1].frameRate).toEqual({ numerator: 60000, denominator: 1001 })
  appendVideoEditMedia(id, { id: 'vfr', name: 'variable', path: 'D:/media/vfr.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 2, frameRateMode: 'variable' })
  const vfr = reopened.document.items.at(-1)!
  expect(() => createVideoEditSequenceFromItem(id, vfr.id)).toThrow('选择剪辑帧率')
  createVideoEditSequenceFromItem(id, vfr.id, { frameRate: { numerator: 30, denominator: 1 } })
})
it('项目浏览选区和标签经通用写入共用状态，不保存且不进入剪辑撤销', async () => {
  const instance = await fixture(); const id = instance.document.id; const app = createApplicationHarness()
  try {
    const second = appendVideoEditSequence(id)
    await saveVideoEdit(id); const history = instance.past.length; const saved = JSON.stringify(savedVideoEdit(instance))
    const changed = await app.change({ kind: 'video_edit.project', id }, { 'video_edit.project.selected_item_ids': [instance.document.items[0].id], 'video_edit.project.open_sequence_ids': [second] })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect(getVideoEditProjectView(id)).toMatchObject({ selectedItemIds: [instance.document.items[0].id], openSequenceIds: [second] })
    expect(instance.activeSequenceId).toBe(second); expect(instance.past).toHaveLength(history); expect(JSON.stringify(savedVideoEdit(instance))).toBe(saved)
    setVideoEditProjectView(id, { selectedItemIds: [] })
    expect((await app.read({ kind: 'video_edit.project', id }, ['video_edit.project.selected_item_ids']) as { properties: Record<string, unknown> }).properties['video_edit.project.selected_item_ids']).toEqual([])
  } finally { app.dispose() }
})
it('一次批量插入保持指定序列和一条历史，不跟随其他序列当前帧', async () => {
  const instance = await fixture(); const id = instance.document.id; const first = instance.activeSequenceId
  const second = appendVideoEditSequence(id); setVideoEditProjectView(id, { openSequenceIds: [second] }); setVideoEditView(id, { frame: 90 })
  const history = instance.past.length
  appendVideoEditItems(id, [instance.document.items[0].id, instance.document.items[0].id], first, { frame: 0 })
  expect(instance.document.sequences[0].clips.map(clip => clip.start)).toEqual([0, 90])
  expect(instance.document.sequences[1].clips).toHaveLength(0); expect(instance.past).toHaveLength(history + 1)
})
it('通用属性可将素材箱、项目项和序列移回根级，与手动服务的清除语义一致', async () => {
  const instance = await fixture(); const id = instance.document.id; const app = createApplicationHarness()
  const parent = createVideoEditBin(id, '父箱'); const child = createVideoEditBin(id, '子箱', parent)
  const item = instance.document.items[0]; updateVideoEditItems(id, [item.id], { binId: parent })
  const sequence = createVideoEditSequenceFromItem(id, item.id, { binId: parent })
  try {
    for (const [kind, childId, property] of [['video_edit.bin', child, 'parent_id'], ['video_edit.item', item.id, 'bin_id'], ['video_edit.sequence', sequence, 'bin_id']]) {
      const ref = { kind, id: `${id}:${childId}` }; const key = `${kind}.${property}`
      expect(await app.change(ref, { [key]: '' })).toMatchObject({ ok: true })
      expect((await app.read(ref, [key]) as { properties: Record<string, unknown> }).properties[key]).toBe('')
    }
    expect(instance.document.items[0].binId).toBeUndefined(); expect(instance.document.bins[1].parentId).toBeUndefined(); expect(instance.document.sequences[1].binId).toBeUndefined()
  } finally { app.dispose() }
})
it('项目会话撤销恢复原活动序列，后续手动选区不被旧撤销覆盖', async () => {
  const instance = await fixture(); const id = instance.document.id; const first = instance.activeSequenceId; const second = appendVideoEditSequence(id)
  setVideoEditProjectView(id, { openSequenceIds: [first, second] })
  const executor = new VideoEditMutationExecutor('video_edit.project')
  const step: Extract<ApplicationPlannedStep, { kind: 'mutation' }> = { kind: 'mutation', entityType: 'video_edit.project', target: { kind: 'video_edit.project', id }, expectedRevisions: { video_edit: 0 }, mutations: [{ propertyId: 'video_edit.project.open_sequence_ids', operation: 'set', value: [second] }] }
  const changed = await executor.apply(step); expect(instance.activeSequenceId).toBe(second)
  await executor.undo(changed.undoToken!); expect(instance.activeSequenceId).toBe(first)
  expect(getVideoEditProjectView(id).openSequenceIds).toEqual([first, second])
  const stale = await executor.apply(step); setVideoEditProjectView(id, { selectedItemIds: [instance.document.items[0].id] })
  await expect(executor.undo(stale.undoToken!)).rejects.toThrow('后续修改')
  expect(instance.activeSequenceId).toBe(second)
  const nameStep = { ...step, mutations: [{ propertyId: 'video_edit.project.name', operation: 'set' as const, value: '改名' }] }
  // 剪辑名就是文件名（3.1）：内容执行器不改名，改名走通用文档属性
  const beforeName = instance.document.name
  await expect(executor.apply(nameStep)).rejects.toThrow('不可写'); expect(instance.document.name).toBe(beforeName)
})
it('缺失源帧率读回明确未知值，删除最后项目引用释放工程媒体容量且可撤销', async () => {
  const instance = await fixture(); const id = instance.document.id; const app = createApplicationHarness()
  appendVideoEditMedia(id, { id: 'still', name: 'still', path: 'D:/media/still.png', kind: 'image', width: 320, height: 180, durationSeconds: 0 })
  try {
    expect((await app.read({ kind: 'video_edit.media', id: `${id}:still` }, ['video_edit.media.frame_rate', 'video_edit.media.frame_rate_mode'])).properties).toMatchObject({ 'video_edit.media.frame_rate': null, 'video_edit.media.frame_rate_mode': 'unknown' })
    const itemId = instance.document.items[1].id
    deleteVideoEditItems(id, [itemId]); expect(instance.document.media.map(media => media.id)).toEqual(['source-video'])
    undoVideoEdit(id); expect(instance.document.media).toHaveLength(2); expect(instance.document.items[1].id).toBe(itemId)
  } finally { app.dispose() }
})
it('空时间线按多源创建匹配序列与片段只提交一条历史；未知帧率失败不留半导入', async () => {
  const instance = await fixture(); const id = instance.document.id; const first = instance.activeSequenceId
  const history = instance.past.length
  await dropVideoEditInput(id, { kind: 'items', projectId: id, itemIds: [instance.document.items[0].id, instance.document.items[0].id] }, { frame: 12, track: 2 }, undefined, { sequenceId: first, createSequenceWhenEmpty: true })
  expect(instance.past).toHaveLength(history + 1)
  expect(getActiveVideoEditSequence(instance)).toMatchObject({ width: 3840, height: 2160, frameRate: { numerator: 60000, denominator: 1001 } })
  expect(getActiveVideoEditSequence(instance).clips.map(clip => clip.start)).toEqual([0, 179])
  undoVideoEdit(id)
  appendVideoEditMedia(id, { id: 'vfr-drop', name: 'unknown', path: 'D:/media/unknown.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 2, frameRateMode: 'variable' })
  const before = instance.document
  await expect(dropVideoEditInput(id, { kind: 'sources', sources: [{ path: 'D:/media/unknown.mp4' }] }, { frame: 0, track: 1 }, undefined, { sequenceId: first, createSequenceWhenEmpty: true })).rejects.toThrow('选择剪辑帧率')
  expect(instance.document).toBe(before)
})
it('重新定位只更新原工程引用并关闭旧源；关闭重开不会接受旧异步结果', async () => {
  const first = await fixture(); const firstId = first.document.id
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValueOnce('D:/other-project.henji-video')
  const other = await createVideoEditProject(); const otherId = other!.document.id
  const image = { id: 'relink-still', name: '原图', kind: 'image' as const, path: 'D:/media/old.png', width: 320, height: 180, durationSeconds: 0, assetId: 'old-asset' }
  appendVideoEditMedia(firstId, image); appendVideoEditMedia(otherId, image)
  const itemId = first.document.items.at(-1)!.id
  const off = registerVideoEditSourcePresenter(firstId, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: false, volume: request.volume }))
  await updateVideoEditSource(firstId, { itemId })
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue('D:/media/new.png')
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
  const closeBitmap = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 640, height: 360, close: closeBitmap }))
  const before = first.past.length; await relinkVideoEditMedia(firstId, image.id)
  expect(first.document.media.at(-1)).toMatchObject({ id: image.id, path: 'D:/media/new.png', width: 640 }); expect(first.document.media.at(-1)?.assetId).toBeUndefined()
  expect(other!.document.media[0]).toEqual(image); expect(readVideoEditSource(firstId).status).toBe('closed'); expect(first.past).toHaveLength(before + 1)
  expect(closeBitmap).toHaveBeenCalledOnce(); off()
  await closeVideoEditProject(otherId); await saveVideoEdit(firstId)
  let finish!: (value: { width: number; height: number; close: () => void }) => void
  vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(resolve => { finish = resolve })))
  const stale = relinkVideoEditMedia(firstId, image.id).catch(error => error as Error)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await closeVideoEditProject(firstId); const reopened = await reopenVideoEdit(first.document.id)
  finish({ width: 1280, height: 720, close: closeBitmap })
  expect(await stale).toBeInstanceOf(Error); expect(reopened.document.media.at(-1)?.width).toBe(640)
})
