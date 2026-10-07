import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { Blob as NativeBlob } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { createCanvasTestProject } from '@/tests/canvasProjectFixture'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import { resetCanvasApplicationStateForTests } from '@/features/canvas/application/canvasApplicationService'
import { closeVideoEditProject, getActiveVideoEditSequence, videoEditExportRange, requireVideoEditInstance, editVideoSequence, listVideoEditInstances, setVideoEditTimelineView, setVideoEditView } from './videoEditService'
import { appendVideoEditCaptionText, exportVideoEditSubtitles } from './videoEditTimedContent'
import { captureVideoEditProgramFrame, registerVideoEditProgramCapture } from './videoEditProgramCapture'
import { collectVideoEditOutput, publishVideoEditOutput } from './videoEditOutputs'
import { cancelVideoEditExport, exportVideoEdit as exportWithSettings, videoEditExportTask } from './videoEditExport'
import { videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import { reopenVideoEdit } from './videoEditDocumentTestKit'
import { harnessDocumentStore } from '@/tests/harnessNativeStorage'

// Publication tests explicitly exclude normalization/collection, which have their own boundary tests.
const exportVideoEdit: typeof exportWithSettings = async (id, target, background, signal, loudness, options) => {
  const owner = requireVideoEditInstance(id); const snapshot = getActiveVideoEditSequence(owner)
  return exportWithSettings(id, target, background, signal, loudness, options ?? { snapshot, range: videoEditExportRange(owner), settings: { ...videoEditSequenceExportSettings(snapshot), loudness: null, addToLibrary: false, captionMode: 'burn' } })
}
// Only codec/pixel and native I/O boundaries are replaced. Services, ownership,
// capability permission/registration, collection and project persistence are real.
const encoder = vi.hoisted(() => ({ finalize: vi.fn(), cancel: vi.fn(), render: vi.fn(), mix: vi.fn(), dispose: vi.fn(), failConstructor: false, videoTimestamps: [] as number[] }))
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], UrlSource: class {}, Input: class {}, Mp4OutputFormat: class {}, StreamTarget: class {},
  Output: class { addVideoTrack() {} addAudioTrack() {} async start() {} finalize = encoder.finalize; cancel = encoder.cancel },
  CanvasSource: class { async add(timestamp: number) { encoder.videoTimestamps.push(timestamp) } }, AudioBufferSource: class { async add() {} },
}))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  canvas = {}; constructor() { if (encoder.failConstructor) throw new Error('GPU unavailable') }
  render = encoder.render; dispose = encoder.dispose; mixAudio = encoder.mix; setSmartRegions = vi.fn()
} }))
const files = new Map<string, string>(); const media = new Map<string, Uint8Array>(); const assets = new Map<string, AssetRecord>()
const hash = 'a'.repeat(64)
const content = { sizeBytes: 5, fileModifiedAt: 1000, contentIdentity: hash }
const png = (): Blob => new Blob(['image'], { type: 'image/png' })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(finish => { resolve = finish }); return { promise, resolve } }
function record(path: string, kind: 'image' | 'video'): AssetRecord {
  return { id: 'published-output', filePath: path, mediaType: kind, displayName: '输出', displayUrl: 'henji-media://local/output', source: 'video-edit', mimeType: kind === 'image' ? 'image/png' : 'video/mp4', ...content, width: 3840, height: 2160, durationSeconds: kind === 'video' ? 1 : 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, createdAt: 1, updatedAt: 2, lastUsedAt: null, tags: [], libraryIds: [] }
}
beforeEach(() => {
  vi.stubGlobal('VideoEncoder', { isConfigSupported: async () => ({ supported: true }) })
  vi.stubGlobal('AudioEncoder', { isConfigSupported: async () => ({ supported: true }) })
  installHarnessNativeStorage(); resetCanvasApplicationStateForTests(); vi.stubGlobal('Blob', NativeBlob); files.clear(); media.clear(); assets.clear(); encoder.failConstructor = false; encoder.videoTimestamps = []
  encoder.finalize.mockReset().mockResolvedValue(undefined); encoder.cancel.mockReset().mockResolvedValue(undefined); encoder.render.mockReset().mockResolvedValue({ singleFrameReads: 0 }); encoder.mix.mockReset().mockResolvedValue({}); encoder.dispose.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('OffscreenCanvas', class { constructor(readonly width: number, readonly height: number) {} getContext() { return { fillRect() {}, drawImage() {}, fillStyle: '' } } })
  const platform = getPlatform()
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/output.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockImplementation(async (path, text) => { files.set(path, text) })
  vi.spyOn(platform.system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(platform.system.fs, 'exists').mockImplementation(async path => media.has(path))
  vi.spyOn(platform.system.fs, 'writeFile').mockImplementation(async (path, bytes, options) => { if (options?.exclusive && media.has(path)) throw new Error('exists'); media.set(path, bytes) })
  vi.spyOn(platform.system.fs, 'remove').mockImplementation(async path => { media.delete(path) })
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue(content)
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => { const value = record(input.filePath, input.mediaType as 'image' | 'video'); value.libraryIds = input.libraryIds ?? []; assets.set(value.id, value); return value })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => { const value = assets.get(id); if (!value) throw new Error('missing asset'); return structuredClone(value) })
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('收录失败保留PNG；同节目帧重试复用已发布文件，不再次解码、选路径或写文件', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  const capture = vi.fn(async () => png()); const unregister = registerVideoEditProgramCapture(owner, owner.activeSequenceId, capture)
  const platform = getPlatform(); vi.mocked(platform.system.dialog.save).mockResolvedValue('D:/frame.png')
  const output = (await captureVideoEditProgramFrame(id))!
  expect(Object.isFrozen(output)).toBe(true); expect(Object.isFrozen(output.content)).toBe(true)
  vi.mocked(platform.assetLibrary.createAsset).mockRejectedValueOnce(new Error('library unavailable'))
  await expect(collectVideoEditOutput(output)).rejects.toThrow('library unavailable')
  expect(media.has(output.path)).toBe(true); expect(platform.system.fs.remove).not.toHaveBeenCalled()
  const again = await captureVideoEditProgramFrame(id)
  expect(again).toBe(output); expect(capture).toHaveBeenCalledOnce(); expect(platform.system.fs.writeFile).toHaveBeenCalledOnce()
  expect(vi.mocked(platform.system.dialog.save).mock.calls).toHaveLength(1) // 只有第一张 PNG 选了路径（新建项目不再弹另存为）
  const asset = await collectVideoEditOutput(output); expect(asset.filePath).toBe(output.path); expect(asset.source).toBe('video-edit')
  expect(owner.past).toHaveLength(0); expect(owner.document.media).toHaveLength(0); unregister()
})

it('真实公共能力回读素材引用；拒绝旧导出任务而不写文件或造素材', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  const unregister = registerVideoEditProgramCapture(owner, owner.activeSequenceId, async () => png())
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValue('D:/public-frame.png')
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('collect_video_edit_output', { documentRef: { kind: 'video_edit.document', id }, kind: 'frame', frame: 0 })
    expect(result.resultRef).toEqual({ kind: 'asset', id: 'published-output' })
    expect(result.verification).toMatchObject({ verified: true })
    const state = await app.read(result.resultRef as { kind: 'asset'; id: string }, ['asset.display_name']); expect(state.properties).toEqual({ 'asset.display_name': '输出' })
    const bad = await app.call('collect_video_edit_output', { documentRef: { kind: 'video_edit.document', id }, kind: 'export', taskId: 'stale-task' })
    expect(bad.ok).toBe(false); expect(getPlatform().assetLibrary.createAsset).toHaveBeenCalledOnce(); expect(getPlatform().system.fs.writeFile).toHaveBeenCalledOnce()
  } finally { app.dispose(); unregister() }
})

it.each(['image', 'video', 'audio'] as const)('%s资产加入未打开画布后保留媒体路径并核实公共回执', async kind => {
  const asset: AssetRecord = { ...record(`D:/published.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`, kind === 'audio' ? 'image' : kind), mediaType: kind }
  assets.set(asset.id, asset)
  const projectId = await createCanvasTestProject(`正式${kind}资产画布`, { attach: false })
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('add_asset_to_canvas', { documentId: projectId, assetId: asset.id, placement: { mode: 'absolute', x: 80, y: 100 } })
    expect(result.verification).toMatchObject({ verified: true })
    expect(result.nodeRef).toEqual({ kind: 'canvas.node', id: `${projectId}:${String(result.nodeId)}` })
    const persisted = await readPersistedCanvasProjectSnapshot(projectId); const node = persisted.nodes.find(node => node.id === result.nodeId)!
    expect(node.data[kind === 'image' ? 'imageUrl' : kind === 'video' ? 'videoUrl' : 'audioUrl']).toBe(asset.filePath)
    const read = await app.read(result.nodeRef as { kind: 'canvas.node'; id: string }); expect(read.ref).toEqual(result.nodeRef)
  } finally { app.dispose() }
})

it('无节目宿主、非当前整数帧、取消和已存在路径都不会写出图片', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  await expect(captureVideoEditProgramFrame(id)).rejects.toThrow('节目面板')
  const capture = vi.fn(async () => png()); const unregister = registerVideoEditProgramCapture(owner, owner.activeSequenceId, capture)
  for (const frame of [-1, .5, 1]) await expect(captureVideoEditProgramFrame(id, frame)).rejects.toThrow('整数帧')
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValue(null); expect(await captureVideoEditProgramFrame(id)).toBeNull()
  media.set('D:/existing.png', new Uint8Array([9])); await expect(captureVideoEditProgramFrame(id, 0, 'D:/existing.png')).rejects.toThrow('新的文件名')
  expect(capture).not.toHaveBeenCalled(); expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled(); unregister()
})

it('仅资产写权限的公共选帧不暂停节目，播放中拒绝且没有文件或素材副作用', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  setVideoEditView(id, { playing: true })
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'asset-only', capabilityIds: ['collect_video_edit_output'], permissions: ['assets:write'], allowWrites: true, allowDestructive: false }))
  const result = await session.execute({ id: 'collect_video_edit_output', version: 1, input: { documentRef: { kind: 'video_edit.document', id }, kind: 'frame' } }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  expect(result.ok).toBe(false); expect(JSON.stringify(result)).toContain('先暂停'); expect(owner.playing).toBe(true); expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled(); expect(getPlatform().assetLibrary.createAsset).not.toHaveBeenCalled()
  setVideoEditView(id, { playing: false })
})

it.each(['dialog', 'save'] as const)('导出提交前%s等待期间取消不创建任务、文件或Renderer', async waiting => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const controller = new AbortController()
  vi.mocked(getPlatform().system.dialog.save).mockClear(); vi.mocked(getPlatform().system.fs.writeTextFile).mockClear()
  const dialog = deferred<string | null>(); const saving = deferred<void>()
  if (waiting === 'dialog') vi.mocked(getPlatform().system.dialog.save).mockReturnValueOnce(dialog.promise)
  else { editVideoSequence(id, owner.activeSequenceId, sequence => ({ ...sequence, name: '待保存修改' })); harnessDocumentStore().saveGate = saving.promise }
  const operation = exportVideoEdit(id, waiting === 'save' ? 'D:/cancelled.mp4' : undefined, true, controller.signal)
  const rejected = expect(operation).rejects.toThrow()
  await vi.waitFor(() => waiting === 'dialog' ? expect(getPlatform().system.dialog.save).toHaveBeenCalled() : expect(harnessDocumentStore().activeSaves).toBe(1))
  controller.abort(); dialog.resolve('D:/cancelled.mp4'); harnessDocumentStore().saveGate = null; saving.resolve(); await rejected
  expect(videoEditExportTask(id)).toBeUndefined(); expect(owner.busy).toBe(false); expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled(); expect(encoder.render).not.toHaveBeenCalled()
})

it.each(['frame', 'revision', 'command', 'cancel', 'reopen'] as const)('等待出帧期间%s改变拒绝发布，不串入新剪辑', async change => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const gate = deferred<Blob>(); const controller = new AbortController()
  const capture = vi.fn(() => gate.promise); const unregister = registerVideoEditProgramCapture(owner, owner.activeSequenceId, capture)
  const operation = captureVideoEditProgramFrame(id, 0, 'D:/stale.png', controller.signal)
  const rejected = expect(operation).rejects.toThrow()
  await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce())
  if (change === 'frame') setVideoEditView(id, { frame: 1 })
  if (change === 'revision') editVideoSequence(id, owner.activeSequenceId, sequence => ({ ...sequence, name: '新序列名' }))
  if (change === 'command') { setVideoEditView(id, { frame: 1 }); setVideoEditView(id, { frame: 0 }) }
  if (change === 'cancel') controller.abort()
  if (change === 'reopen') { await closeVideoEditProject(id); await reopenVideoEdit(owner.document.id) }
  gate.resolve(png()); await rejected
  expect(getPlatform().system.fs.writeFile).not.toHaveBeenCalled(); expect(getPlatform().assetLibrary.createAsset).not.toHaveBeenCalled(); unregister()
})

it('发布后原文件改变、取消或原剪辑关闭，收录均拒绝；同ID重开不接管旧回执', async () => {
  const owner = (await createVideoEditProject())!; const output = await publishVideoEditOutput({ owner, path: 'D:/finished.mp4', sequenceId: owner.activeSequenceId, revision: 0, kind: 'video', name: '成片' })
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValueOnce({ ...content, contentIdentity: 'b'.repeat(64) })
  await expect(collectVideoEditOutput(output)).rejects.toThrow('已改变')
  const controller = new AbortController(); controller.abort(); await expect(collectVideoEditOutput(output, {}, controller.signal)).rejects.toThrow()
  await closeVideoEditProject(owner.document.id); await reopenVideoEdit(owner.document.id)
  await expect(collectVideoEditOutput(output)).rejects.toThrow('原剪辑已关闭'); expect(getPlatform().assetLibrary.createAsset).not.toHaveBeenCalled()
})

it('收录提交前取消拒绝；已提交后不删除文件或已消费资产', async () => {
  const owner = (await createVideoEditProject())!; const output = await publishVideoEditOutput({ owner, path: 'D:/finished.mp4', sequenceId: owner.activeSequenceId, revision: 0, kind: 'video', name: '成片' })
  const controller = new AbortController(); const gate = deferred<typeof content>()
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockReturnValueOnce(gate.promise)
  const pending = collectVideoEditOutput(output, {}, controller.signal); const rejected = expect(pending).rejects.toThrow()
  await expect(collectVideoEditOutput(output)).rejects.toThrow('正在加入')
  controller.abort(); gate.resolve(content); await rejected; expect(getPlatform().assetLibrary.createAsset).not.toHaveBeenCalled()
  const late = new AbortController()
  vi.mocked(getPlatform().assetLibrary.createAsset).mockImplementationOnce(async input => { late.abort(); const asset = record(input.filePath, 'video'); assets.set(asset.id, asset); return asset })
  expect((await collectVideoEditOutput(output, {}, late.signal)).id).toBe('published-output'); expect(getPlatform().system.fs.remove).not.toHaveBeenCalled()
})

it('目标集合必须存在；提交后素材内容核验失败保留记录及文件供核对', async () => {
  const owner = (await createVideoEditProject())!; const platform = getPlatform()
  const output = await publishVideoEditOutput({ owner, path: 'D:/finished.mp4', sequenceId: owner.activeSequenceId, revision: 0, kind: 'video', name: '成片' })
  await expect(collectVideoEditOutput(output, { libraryId: 'missing-library' })).rejects.toThrow()
  expect(platform.assetLibrary.createAsset).not.toHaveBeenCalled()
  const library = await platform.assetLibrary.createLibrary('成片集合')
  vi.mocked(platform.assetLibrary.inspectAsset).mockResolvedValueOnce(record('D:/different.mp4', 'video'))
  await expect(collectVideoEditOutput(output, { libraryId: library.id })).rejects.toThrow('文件已保留')
  expect(assets.get('published-output')?.libraryIds).toEqual([library.id]); expect(platform.system.fs.remove).not.toHaveBeenCalled()
})

it('导出回执冻结原序列；成片收录失败可重试且不会重新编码；重开不保留旧任务', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  await exportVideoEdit(id, 'D:/finished.mp4'); const task = videoEditExportTask(id)!
  expect(task.state).toBe('completed'); expect(task.output).toMatchObject({ owner, sequenceId: owner.activeSequenceId, path: 'D:/finished.mp4', revision: 0, kind: 'video' })
  editVideoSequence(id, owner.activeSequenceId, sequence => ({ ...sequence, name: '后续编辑' }))
  vi.mocked(getPlatform().assetLibrary.createAsset).mockRejectedValueOnce(new Error('not available'))
  await expect(collectVideoEditOutput(task.output!)).rejects.toThrow('not available'); expect(media.has('D:/finished.mp4')).toBe(true)
  await collectVideoEditOutput(task.output!); expect(encoder.finalize).toHaveBeenCalledOnce(); expect(encoder.dispose).toHaveBeenCalledOnce(); expect(task.output!.revision).toBe(0)
  await closeVideoEditProject(id); await reopenVideoEdit(owner.document.id); expect(videoEditExportTask(id)).toBeUndefined()
})

it('编码完成后内容核验失败仍保留成片并释放忙状态', async () => {
  const owner = (await createVideoEditProject())!
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockRejectedValueOnce(new Error('probe unavailable'))
  await expect(exportVideoEdit(owner.document.id, 'D:/finished.mp4')).rejects.toThrow('成片已保存')
  expect(videoEditExportTask(owner.document.id)).toMatchObject({ state: 'completed' }); expect(media.has('D:/finished.mp4')).toBe(true)
  expect(owner.busy).toBe(false); expect(encoder.cancel).not.toHaveBeenCalled(); expect(getPlatform().system.fs.remove).not.toHaveBeenCalled()
})

it.each(['constructor', 'render', 'cancel-last-frame'] as const)('完成前%s失败仅清理自建未完成文件并释放忙状态', async failure => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  if (failure === 'constructor') encoder.failConstructor = true
  if (failure === 'render') encoder.render.mockRejectedValueOnce(new Error('decode failed'))
  if (failure === 'cancel-last-frame') encoder.render.mockImplementationOnce(async () => { cancelVideoEditExport(id); return { singleFrameReads: 0 } })
  if (failure === 'cancel-last-frame') expect(await exportVideoEdit(id, 'D:/unfinished.mp4')).toBeNull()
  else await expect(exportVideoEdit(id, 'D:/unfinished.mp4')).rejects.toThrow()
  expect(owner.busy).toBe(false); expect(media.has('D:/unfinished.mp4')).toBe(false); expect(encoder.finalize).not.toHaveBeenCalled()
  expect(videoEditExportTask(id)?.state).toBe(failure === 'cancel-last-frame' ? 'cancelled' : 'failed')
  expect(getPlatform().system.fs.remove).toHaveBeenCalledTimes(failure === 'constructor' ? 0 : 1)
})

it.each([['画面', 45, '00:00:01:15'], ['声音', 30, '00:00:01:00']] as const)('导出中%s取不到准确内容时停在该帧：提示序列位置与原因，删除半成品且不编码之后的帧', async (kind, frame, timecode) => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditCaptionText(id, owner.activeSequenceId, '1\n00:00:00,000 --> 00:00:03,000\n字幕')
  const reason = kind === '画面' ? '素材「A.mov」取不到准确的画面：解码失败，请确认文件可用，或在素材面板中重新定位源文件。' : '素材「A.mov」的声音读取失败，请确认文件可用，或在素材面板中重新定位源文件。'
  if (kind === '画面') encoder.render.mockImplementation(async (at: number) => { if (at === frame) throw new Error(reason); return { singleFrameReads: 0 } })
  else encoder.mix.mockImplementation(async (start: number) => { if (Math.round(start * 30) === frame) throw new Error(reason); return {} })
  await expect(exportVideoEdit(id, 'D:/stopped.mp4')).rejects.toThrow(`导出在 ${timecode} 处停止。${reason}`)
  expect(videoEditExportTask(id)).toMatchObject({ state: 'failed', error: `导出在 ${timecode} 处停止。${reason}` })
  // Every frame before the failing one was encoded; nothing at or after it.
  expect(encoder.videoTimestamps).toHaveLength(frame)
  expect(media.has('D:/stopped.mp4')).toBe(false); expect(encoder.finalize).not.toHaveBeenCalled(); expect(encoder.cancel).toHaveBeenCalledOnce(); expect(owner.busy).toBe(false)
})

it('序列入出点选定导出半开范围：成片与字幕文件从入点计时，范围外内容不导出', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const fps = owner.document.sequences[0].frameRate.numerator / owner.document.sequences[0].frameRate.denominator
  appendVideoEditCaptionText(id, owner.activeSequenceId, '1\n00:00:00,000 --> 00:00:01,000\n范围前\n\n2\n00:00:01,000 --> 00:00:03,000\n跨入点\n\n3\n00:00:03,000 --> 00:00:04,000\n范围后')
  setVideoEditTimelineView(id, { inFrame: 2 * fps, outFrame: 3 * fps })
  await exportVideoEdit(id, 'D:/range.mp4')
  expect(videoEditExportTask(id)).toMatchObject({ state: 'completed', startFrame: 2 * fps, endFrame: 3 * fps, progress: 1 })
  expect(encoder.render.mock.calls.map(([frame]) => frame)).toEqual(Array.from({ length: fps }, (_, index) => 2 * fps + index))
  expect(encoder.videoTimestamps[0]).toBe(0); expect(encoder.videoTimestamps.at(-1)).toBeCloseTo((fps - 1) / fps)
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValueOnce('D:/range.srt')
  expect(await exportVideoEditSubtitles(id, 'srt')).toEqual({ saved: true, verified: true })
  expect(files.get('D:/range.srt')).toBe('1\n00:00:00,000 --> 00:00:01,000\n跨入点\n')
  setVideoEditTimelineView(id, { inFrame: 5 * fps, outFrame: null })
  await expect(exportVideoEdit(id, 'D:/empty.mp4')).rejects.toThrow('入点之后没有可导出的内容'); expect(media.has('D:/empty.mp4')).toBe(false)
})
