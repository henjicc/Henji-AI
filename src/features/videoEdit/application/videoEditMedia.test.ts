// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { HENJI_DRAG_DATA_MIME } from '@/contexts/dragDataTransfer'
import { appendVideoEditMedia, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, saveVideoEdit, undoVideoEdit } from './videoEditService'
import { ensureVideoEditMediaAudioStreams, importVideoEditSources, inspectVideoEditMedia, relinkVideoEditMedia, VIDEO_EDIT_IMPORT_EXTENSIONS } from './videoEditMedia'
import { inferLocalMediaKind } from '@/services/localMediaImport'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { dropVideoEditInput, readVideoEditDrop, videoEditDropPaths } from './videoEditDrop'
import { savedVideoEdit, reopenVideoEdit, createLegacyTrackVideoEditProject } from './videoEditDocumentTestKit'
import { recordVideoEditExport, updateVideoEditCreativeIntents, updateVideoEditInPlaceMetadata } from './videoEditService'
import { planVideoEditInPlaceGeneration } from '@/core/videoEdit/inPlaceGeneration'
import { videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import type { VideoEditInPlaceRecord } from '@/core/videoEdit/inPlacePersistence'
import { resolve } from 'node:path'
import { videoEditComposition } from '@/core/videoEdit/document'
import { videoEditTextMediaIdentity } from '@/core/videoEdit/textTranscript'

const files = new Map<string, string>()
const video = vi.hoisted(() => ({ duration: 3, fps: 60, hasAudio: false, decodable: true, audioOnly: false }))
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], UrlSource: class {},
  Input: class {
    async getPrimaryVideoTrack() { return video.audioOnly ? null : { codec: null, displayWidth: 3840, displayHeight: 2160, canDecode: async () => video.decodable, computeFrameRateMetrics: async () => ({ probedPacketCount: 256, bestGuessFrameRate: video.fps, frameRateIsConstant: true }) } }
    async getPrimaryAudioTrack() { return video.hasAudio ? { canDecode: async () => true } : null }
    async getAudioTracks() { return video.hasAudio ? [{ numberOfChannels: 2, sampleRate: 48000 }] : [] }
    async computeDuration() { return video.duration }
    dispose() {}
  },
}))
function asset(patch: Partial<AssetRecord> = {}): AssetRecord {
  return { id: 'image-asset', mediaType: 'image', displayName: '正式原图', filePath: 'D:/media/original.png', displayUrl: 'henji-media://local/original', source: 'imported', mimeType: 'image/png', sizeBytes: 4096, width: 3840, height: 2160, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 2, tags: [], libraryIds: [], ...patch }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}
it('导入复核保留导出、讲解及其他生成记录，只合并本次落位记录的改动', async () => {
  const owner = await createLegacyTrackVideoEditProject(); const id = owner.document.id; const sequence = getActiveVideoEditSequence(owner)
  const plan = planVideoEditInPlaceGeneration(owner.document, sequence.id, { action: 'generate_shot', frame: 0, duration: 30 })
  const first: VideoEditInPlaceRecord = { id: 'landing', taskId: 'landing-task', modelId: 'model', plan, request: { sequenceId: sequence.id, intent: { action: 'generate_shot' }, prompt: '镜头' }, status: 'generating' }
  const second: VideoEditInPlaceRecord = { ...first, id: 'other', taskId: 'other-task' }
  updateVideoEditInPlaceMetadata(id, [first, second]); const contentVersion = owner.contentVersion
  const exportEntry = { id: 'export', taskId: 'export-task', sequenceId: sequence.id, name: '成片', presetName: '序列', path: resolve('fixture', 'export.mp4'), completedAt: 1, rangeSource: 'content' as const, settings: videoEditSequenceExportSettings(sequence), range: { startFrame: 0, endFrame: 30 } }
  vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValueOnce(asset()).mockImplementationOnce(async () => {
    recordVideoEditExport(id, exportEntry)
    updateVideoEditCreativeIntents(id, { drafts: [], sessions: [], resources: [] })
    updateVideoEditInPlaceMetadata(id, [{ ...first, error: '并发保留' }, { ...second, status: 'failed', error: '另一个任务失败' }, { ...second, id: 'new', taskId: 'new-task' }])
    expect(owner.contentVersion).toBe(contentVersion)
    return asset()
  })
  await importVideoEditSources(id, [{ assetId: 'image-asset' }], undefined, undefined, document => ({ ...document, inPlaceGenerations: document.inPlaceGenerations!.map(record => record.id === first.id ? { ...record, status: 'placing', clipId: 'landed-clip' } : record) }))
  expect(owner.document.exportHistory).toEqual([exportEntry])
  expect(owner.document.creativeIntents).toEqual({ drafts: [], sessions: [], resources: [] })
  expect(owner.document.inPlaceGenerations).toEqual([{ ...first, status: 'placing', clipId: 'landed-clip', error: '并发保留' }, { ...second, status: 'failed', error: '另一个任务失败' }, { ...second, id: 'new', taskId: 'new-task' }])
  expect(owner.contentVersion).toBe(contentVersion + 1)
})
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) })
  // 测试环境没有原生解码服务：按“不可用”走后备探测，而不是让替身抛错再记一条探测异常。
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue(undefined)
  vi.spyOn(videoEditNativeMediaProbe, 'probe').mockResolvedValue({ status: 'unavailable' })
  Object.assign(video, { duration: 3, fps: 60, hasAudio: false, decodable: true, audioOnly: false })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/asset-reference.hjvid')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, content) => { files.set(path, content) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/media')
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
})

it('拖包路径不能覆盖正式assetId；导入落点与来源一次历史并保存重开', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue(asset())
  const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode)
  const transfer = { types: [HENJI_DRAG_DATA_MIME], getData: () => JSON.stringify({ type: 'image', imageUrl: 'https://invalid.test/forged.png', sourceType: 'asset', assetId: 'image-asset', filePath: 'E:/forged.png' }) } as unknown as DataTransfer
  expect(() => videoEditDropPaths(transfer)).toThrow('正式素材引用')
  const input = readVideoEditDrop(transfer); expect(input).toEqual({ kind: 'sources', sources: [{ assetId: 'image-asset' }] })
  const history = owner.past.length
  await dropVideoEditInput(id, input, { frame: 12, track: 1 })
  expect(owner.past).toHaveLength(history + 1); expect(inspect).toHaveBeenCalledTimes(2); expect(decode).not.toHaveBeenCalled()
  expect(owner.document.media[0]).toMatchObject({ path: 'D:/media/original.png', assetId: 'image-asset', assetContent: { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) } })
  expect(owner.document.sequences[0].clips[0]).toMatchObject({ start: 12, track: 1, itemId: owner.document.items[0].id })
  await saveVideoEdit(id); const snapshot = structuredClone(owner.document)
  await closeVideoEditProject(id); const reopened = await reopenVideoEdit(owner.document.id)
  expect(reopened.document).toEqual({ ...snapshot, revision: 0 })
  await importVideoEditSources(id, [{ assetId: 'image-asset', path: 'E:/different.png' }])
  expect(reopened.document.media).toHaveLength(1); expect(reopened.document.items).toHaveLength(1)
})

it.each(['content', 'path', 'pending', 'deleted'] as const)('最终%s改变拒绝整批发布，不留导入、片段或保存', async change => {
  const owner = (await createLegacyTrackVideoEditProject()); const baseline = owner.document; const history = owner.past.length; const saved = JSON.stringify(savedVideoEdit(owner))
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValueOnce(asset())
  if (change === 'deleted') inspect.mockRejectedValueOnce(new Error('资产不存在'))
  else inspect.mockResolvedValueOnce(asset(change === 'content' ? { contentIdentity: 'b'.repeat(64) } : change === 'path' ? { filePath: 'D:/media/relocated.png' } : { inspectionStatus: 'pending' }))
  await expect(dropVideoEditInput(owner.document.id, { kind: 'sources', sources: [{ assetId: 'image-asset' }] }, { frame: 0, track: 1 })).rejects.toThrow()
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history); expect(JSON.stringify(savedVideoEdit(owner))).toBe(saved)
})

it('改名标签与最近使用允许复核；首次绑定旧路径刷新资源身份且可撤销', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  appendVideoEditMedia(id, { id: 'old-path', path: 'D:/media/original.png', name: '旧路径', kind: 'image', width: 3840, height: 2160, durationSeconds: 0, sourceRevision: 'old-revision' })
  const original = owner.document
  vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValueOnce(asset()).mockResolvedValueOnce(asset({ displayName: '改名', tags: ['标签'], lastUsedAt: 9000, updatedAt: 9000 }))
  await importVideoEditSources(id, [{ assetId: 'image-asset' }])
  expect(owner.document.media).toHaveLength(1); expect(owner.document.media[0].sourceRevision).not.toBe('old-revision'); expect(owner.document.media[0].assetContent?.contentIdentity).toBe('a'.repeat(64))
  undoVideoEdit(id); expect(owner.document.media).toEqual(original.media); expect(owner.document.items).toEqual(original.items)
})

it('已绑定同路径的新内容须显式relink，原路径入口不能绕过内容核对', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue(asset())
  await importVideoEditSources(id, [{ assetId: 'image-asset' }]); const baseline = owner.document
  inspect.mockResolvedValue(asset({ contentIdentity: 'b'.repeat(64) }))
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'b'.repeat(64) })
  for (const source of [{ assetId: 'image-asset' }, { path: 'D:/media/original.png' }]) {
    await expect(importVideoEditSources(id, [source])).rejects.toThrow('重新定位'); expect(owner.document).toBe(baseline)
  }
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue('D:/media/original.png')
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
  const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3840, height: 2160, close }))
  await relinkVideoEditMedia(id, baseline.media[0].id)
  expect(owner.document.media[0]).toMatchObject({ id: baseline.media[0].id, assetId: 'image-asset', assetContent: { contentIdentity: 'b'.repeat(64) } })
  expect(owner.document.media[0].sourceRevision).not.toBe(baseline.media[0].sourceRevision); expect(close).toHaveBeenCalledOnce()
  undoVideoEdit(id); expect(owner.document.media).toEqual(baseline.media); expect(owner.document.items).toEqual(baseline.items)
})

it('关闭同ID重开与取消不能接收晚到解析，元数据队列继续可用', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; await saveVideoEdit(id)
  const pending = deferred<AssetRecord>()
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockImplementationOnce(() => pending.promise).mockResolvedValue(asset())
  const late = importVideoEditSources(id, [{ assetId: 'image-asset' }]).catch(error => error)
  await vi.waitFor(() => expect(inspect).toHaveBeenCalledOnce())
  await closeVideoEditProject(id); const reopened = await reopenVideoEdit(owner.document.id)
  pending.resolve(asset()); expect(await late).toBeInstanceOf(Error); expect(reopened.document.media).toHaveLength(0)
  const controller = new AbortController()
  const cancelled = importVideoEditSources(id, [{ assetId: 'image-asset' }], undefined, controller.signal); controller.abort()
  await expect(cancelled).rejects.toThrow(); expect(reopened.document.media).toHaveLength(0)
  await importVideoEditSources(id, [{ assetId: 'image-asset' }]); expect(reopened.document.media).toHaveLength(1)
})
it('删除素材库条目后原路径仍可重复引用和显式恢复，不重新登记或自动追随资产', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const library = vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue(asset())
  await importVideoEditSources(id, [{ assetId: 'image-asset' }]); const baseline = owner.document
  library.mockRejectedValue(new Error('资产不存在'))
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) })
  await importVideoEditSources(id, [{ path: 'D:/media/original.png' }])
  expect(owner.document.media).toEqual(baseline.media); expect(library).toHaveBeenCalledTimes(2)
  inspect.mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'b'.repeat(64) })
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue('D:/media/original.png')
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3840, height: 2160, close: vi.fn() }))
  await relinkVideoEditMedia(id, baseline.media[0].id)
  expect(owner.document.media[0]).toMatchObject({ path: 'D:/media/original.png', assetId: 'image-asset', assetContent: { contentIdentity: 'b'.repeat(64) } })
  expect(library).toHaveBeenCalledTimes(2)
})

it('候选处理和最终解析期间的手动修改保留，不被旧草稿覆盖', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const pending = deferred<AssetRecord>()
  const inspect = vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValueOnce(asset()).mockImplementationOnce(() => pending.promise)
  const importing = importVideoEditSources(id, [{ assetId: 'image-asset' }]).catch(error => error)
  await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(2))
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '新手动编辑' }) })); const baseline = owner.document
  pending.resolve(asset()); expect(await importing).toBeInstanceOf(Error); expect(owner.document).toBe(baseline); expect(owner.document.media).toHaveLength(0)
})

it('公共导入使用同一可信解析与静默保存', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue(asset())
  const app = createApplicationHarness()
  try {
    const result = await app.call('import_video_edit_asset', { documentRef: { kind: 'video_edit.document', id }, assetRef: { kind: 'asset', id: 'image-asset' } })
    expect(result).toMatchObject({ ok: true }); expect(owner.document.media).toHaveLength(1)
    expect(savedVideoEdit(owner).media[0].assetContent!.contentIdentity).toBe('a'.repeat(64))
  } finally { app.dispose() }
})

it.each(['duration', 'fps', 'hasAudio'] as const)('旧视频首次可信绑定必须核验当前%s，不认证旧元数据', async field => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  appendVideoEditMedia(id, { id: 'legacy', path: 'D:/media/legacy.mp4', name: '旧视频', kind: 'video', width: 3840, height: 2160, durationSeconds: 3, hasAudio: false, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' })
  vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue(asset({ mediaType: 'video', filePath: 'D:/media/legacy.mp4', durationSeconds: field === 'duration' ? 4 : 3 }))
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  if (field === 'duration') video.duration = 4
  if (field === 'fps') video.fps = 30
  if (field === 'hasAudio') video.hasAudio = true
  const baseline = owner.document
  await expect(importVideoEditSources(id, [{ assetId: 'image-asset' }])).rejects.toThrow('时长、帧率或音轨')
  expect(owner.document).toBe(baseline); expect(owner.document.media[0].assetContent).toBeUndefined()
})

it('导入先问原生探测：只有原生能解的专业格式按原生元数据导入且只写现有字段；原生不可用时给出格式提示、剪辑不变；原生故障不阻断后备', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue(undefined)
  video.decodable = false
  const native = vi.spyOn(videoEditNativeMediaProbe, 'probe').mockResolvedValue({ status: 'unavailable' })
  const baseline = owner.document
  await expect(importVideoEditSources(id, [{ path: 'D:/media/lotus.mov' }])).rejects.toThrow('当前设备无法解码此视频（MOV 文件中的视频编码）')
  native.mockResolvedValue({ status: 'probed', probe: { container: { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', startTimeSeconds: 0, durationSeconds: 14.283 }, primaryVideoStreamIndex: 0, primaryAudioStreamIndex: null, streams: [
    { index: 0, kind: 'video', codec: 'prores', profile: '4444', startTimeSeconds: 0, durationSeconds: 14.283, isAttachedPicture: false, decodable: true, video: { width: 2560, height: 2560, bitDepth: 12, chromaSubsampling: '4:4:4', hasAlpha: true, avgFrameRate: { num: 60, den: 1 }, realFrameRate: { num: 60, den: 1 }, rotationDegrees: null } },
  ] } })
  expect(owner.document).toBe(baseline)
  await importVideoEditSources(id, [{ path: 'D:/media/lotus.mov' }])
  expect(native).toHaveBeenCalledWith('D:/media/lotus.mov', expect.any(AbortSignal))
  expect(owner.document.media[0]).toMatchObject({ path: 'D:/media/lotus.mov', kind: 'video', width: 2560, height: 2560, durationSeconds: 14.283, hasAudio: false, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' })
  expect(Object.keys(owner.document.media[0]).sort()).toEqual(['assetContent', 'durationSeconds', 'frameRate', 'frameRateMode', 'hasAudio', 'height', 'id', 'kind', 'name', 'path', 'width'])
  video.decodable = true; native.mockRejectedValue(new Error('服务崩溃'))
  await importVideoEditSources(id, [{ path: 'D:/media/clip.mp4' }])
  expect(owner.document.media[1]).toMatchObject({ path: 'D:/media/clip.mp4', width: 3840, height: 2160, durationSeconds: 3, frameRateMode: 'sampled-constant' })
  expect(Object.keys(owner.document.media[1]).sort()).toEqual(['assetContent', 'durationSeconds', 'frameRate', 'frameRateMode', 'hasAudio', 'height', 'id', 'kind', 'name', 'path', 'width'])
})
it('诊断变量强制浏览器时不调用原生探测', async () => {
  const owner = (await createLegacyTrackVideoEditProject())
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue('browser')
  const native = vi.spyOn(videoEditNativeMediaProbe, 'probe')
  await importVideoEditSources(owner.document.id, [{ path: 'D:/media/clip.mp4' }])
  expect(native).not.toHaveBeenCalled(); expect(owner.document.media).toHaveLength(1)
})
it('快速模式保存的 MP4 带录制事件：导入即绑定为录屏素材（光标已在画面里，只画点击）；读取失败按普通视频导入', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  const cursor = { ownerRef: { kind: 'screen_recording.video_file', id: 'f'.repeat(32) }, sourceDigest: `sha256:${'f'.repeat(64)}`, cursorBakedIn: true, recordingStartUs: 0, width: 3840, height: 2160, pages: [{ path: 'D:/events/0000000000000000-' + 'a'.repeat(64) + '.capture.json', sha256: 'a'.repeat(64), recordingSpanUs: [0, 3_000_000], seqSpan: [0, 9] }] }
  const capture = vi.spyOn(getPlatform().screenRecording, 'capture').mockImplementation(async request => request.operation === 'embedded-events' && request.path.endsWith('quick.mp4') ? { cursor, events: [] } : null)
  await importVideoEditSources(id, [{ path: 'D:/media/quick.mp4' }, { path: 'D:/media/plain.mp4' }])
  expect(capture).toHaveBeenCalledWith({ operation: 'embedded-events', path: 'D:/media/quick.mp4' })
  expect(owner.document.media.find(media => media.path.endsWith('quick.mp4'))?.recordingCursor).toEqual(cursor)
  expect(owner.document.media.find(media => media.path.endsWith('plain.mp4'))?.recordingCursor).toBeUndefined()
  capture.mockRejectedValue(new Error('文件被占用'))
  await importVideoEditSources(id, [{ path: 'D:/media/locked.mp4' }])
  expect(owner.document.media.find(media => media.path.endsWith('locked.mp4'))).toMatchObject({ kind: 'video', durationSeconds: 3 })
  expect(owner.document.media.find(media => media.path.endsWith('locked.mp4'))?.recordingCursor).toBeUndefined()
})
it('剪辑导入对话框的每种格式都能进入素材库，从素材库拖入不会被类型判定拦下', () => {
  for (const extension of VIDEO_EDIT_IMPORT_EXTENSIONS) expect(inferLocalMediaKind({ name: `素材.${extension}`, type: '' }), extension).not.toBeNull()
})

it('多音轨 MXF（2.6）：导入记录四条单声道流，拖入时间线铺成画面加四个链接单声道片段并新增音频轨，一次撤销全部回到拖入前；保存重开不变', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue(undefined)
  video.decodable = false
  const pcm = (index: number) => ({ index, kind: 'audio' as const, codec: 'pcm_s24le', profile: null, startTimeSeconds: 0, durationSeconds: 4, isAttachedPicture: false, decodable: true, audio: { sampleRate: 48000, channels: 1 } })
  vi.spyOn(videoEditNativeMediaProbe, 'probe').mockResolvedValue({ status: 'probed', probe: { container: { formatName: 'mxf', startTimeSeconds: 0, durationSeconds: 4 }, primaryVideoStreamIndex: 0, primaryAudioStreamIndex: 1, streams: [
    { index: 0, kind: 'video', codec: 'dnxhd', profile: 'DNXHR LB', startTimeSeconds: 0, durationSeconds: 4, isAttachedPicture: false, decodable: true, video: { width: 1280, height: 720, bitDepth: 8, chromaSubsampling: '4:2:2', hasAlpha: false, avgFrameRate: { num: 30, den: 1 }, realFrameRate: { num: 30, den: 1 }, rotationDegrees: null } },
    pcm(1), pcm(2), pcm(3), pcm(4),
  ] } })
  const [itemId] = await importVideoEditSources(id, [{ path: 'D:/media/four.mxf' }])
  expect(owner.document.media[0].audioStreams).toEqual([{ channels: 1, sampleRate: 48000 }, { channels: 1, sampleRate: 48000 }, { channels: 1, sampleRate: 48000 }, { channels: 1, sampleRate: 48000 }])
  const before = owner.document
  await dropVideoEditInput(id, { kind: 'items', projectId: id, itemIds: [itemId] }, { frame: 15 })
  const sequence = getActiveVideoEditSequence(owner)
  expect(sequence.tracks.filter(track => track.kind === 'audio').map(track => track.name)).toEqual(['音频 1', '音频 2', '音频 3', '音频 4'])
  expect(sequence.clips.map(clip => [clip.kind, clip.sourceComponent, clip.audioMapping?.sources[0].stream ?? 0, clip.start])).toEqual([['video', 'video', 0, 15], ['audio', 'audio', 0, 15], ['audio', 'audio', 1, 15], ['audio', 'audio', 2, 15], ['audio', 'audio', 3, 15]])
  expect(sequence.clips.every(clip => clip.linkId && clip.linkId === sequence.clips[0].linkId)).toBe(true)
  // Tracks and clips are one history step.
  undoVideoEdit(id)
  expect(owner.document.sequences).toEqual(before.sequences)
  undoVideoEdit(id, true)
  await saveVideoEdit(id); await closeVideoEditProject(id)
  const reopened = await reopenVideoEdit(owner.document.id)
  expect(getActiveVideoEditSequence(reopened).clips).toEqual(sequence.clips)
  expect(getActiveVideoEditSequence(reopened).tracks).toHaveLength(11)
})
it('旧剪辑素材没有声音流清单：打开音频声道设置时按需读取一次并记录，不迁移其余素材；无声素材给出提示', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue('browser')
  appendVideoEditMedia(id, { id: 'old', name: '旧视频', path: 'D:/media/old.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 3, hasAudio: true, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' })
  appendVideoEditMedia(id, { id: 'other', name: '另一旧视频', path: 'D:/media/other.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 3, hasAudio: true })
  video.hasAudio = true
  expect(await ensureVideoEditMediaAudioStreams(id, 'old')).toEqual([{ channels: 2, sampleRate: 48000 }])
  expect(owner.document.media.find(media => media.id === 'old')!.audioStreams).toEqual([{ channels: 2, sampleRate: 48000 }])
  expect(owner.document.media.find(media => media.id === 'other')).not.toHaveProperty('audioStreams')
  video.hasAudio = false
  expect(await ensureVideoEditMediaAudioStreams(id, 'old')).toEqual([{ channels: 2, sampleRate: 48000 }])
  await expect(ensureVideoEditMediaAudioStreams(id, 'other')).rejects.toThrow('没有可用的声音')
})

it('直接路径导入固定文件身份，保存重开后内容查询可核实；替换原文件拒绝旧证据', async () => {
  const owner = await createLegacyTrackVideoEditProject(); const id = owner.document.id
  const sourcePath = resolve('fixture', 'indexed-source.mp4')
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  const inspect = vi.mocked(getPlatform().assetLibrary.inspectFileContent)
  const history = owner.past.length
  const [itemId] = await importVideoEditSources(id, [{ path: sourcePath }])
  expect(owner.document.media[0]).toMatchObject({ path: sourcePath, assetContent: { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) } })
  expect(owner.past.length).toBe(history + 1)
  editVideoProject(id, document => {
    document.sequences[0].textTranscription = { audioDocumentId: 'recognized', sources: [{ itemId, mediaIdentity: videoEditTextMediaIdentity(videoEditComposition(document, document.sequences[0].id), itemId), silences: [], blocks: [{ id: 'old-word', text: '旧句', startFrame: 0, endFrame: 1000000, granularity: 'word', included: true, locked: false }] }] }
    return document
  })
  await saveVideoEdit(id); const reopened = await reopenVideoEdit(id)
  expect(reopened.document.media[0].assetContent).toEqual(owner.document.media[0].assetContent)
  const app = createApplicationHarness()
  const input = { documentRef: { kind: 'video_edit.document', id }, itemRef: { kind: 'video_edit.item', id: `${id}:${itemId}` }, text: '旧句' }
  try {
    expect(await app.call('query_video_edit_content', input)).toMatchObject({ ok: true, data: { total: 1, sourceVerified: true, warnings: [] } })
    inspect.mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'b'.repeat(64) })
    expect(await app.call('query_video_edit_content', input)).toMatchObject({ ok: false })
    const baseline = reopened.document
    await expect(importVideoEditSources(id, [{ path: sourcePath }])).rejects.toThrow('重新定位')
    expect(reopened.document).toBe(baseline)
    vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue(sourcePath)
    await relinkVideoEditMedia(id, reopened.document.media[0].id)
    expect(await app.call('query_video_edit_content', input)).toMatchObject({ ok: true, data: { total: 0, sourceVerified: true } })
  } finally { app.dispose() }
})

it.each(['probe', 'publish'] as const)('原文件在%s阶段变化，整批导入原子拒绝，不留下错误元数据或历史', async phase => {
  const owner = await createLegacyTrackVideoEditProject(); const baseline = owner.document; const history = owner.past.length
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  const replace = () => vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'b'.repeat(64) })
  if (phase === 'probe') vi.mocked(videoEditNativeMediaProbe.probe).mockImplementationOnce(async () => { replace(); return { status: 'unavailable' } })
  await expect(importVideoEditSources(owner.document.id, [{ path: resolve('fixture', 'changing.mp4') }], undefined, undefined, document => {
    if (phase === 'publish') replace()
    return document
  })).rejects.toThrow(phase === 'probe' ? '素材探测期间已改变' : '重新定位')
  expect(owner.document).toBe(baseline); expect(owner.past.length).toBe(history)
})

it('重新定位直接路径会重新绑定身份；未绑定的旧引用不能静默补认证', async () => {
  const owner = await createLegacyTrackVideoEditProject(); const id = owner.document.id
  const oldPath = resolve('fixture', 'old-image.png'); const newPath = resolve('fixture', 'new-image.png')
  appendVideoEditMedia(id, { id: 'unbound', kind: 'image', name: '旧图', path: oldPath, width: 64, height: 64, durationSeconds: 0 })
  const baseline = owner.document
  await expect(importVideoEditSources(id, [{ path: oldPath }])).rejects.toThrow('尚未绑定原文件身份')
  expect(owner.document).toBe(baseline)
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue(newPath)
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
  const close = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 64, height: 64, close }))
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementation(async (_path, kind) => ({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: (kind === 'image' ? 'c' : 'a').repeat(64) }))
  await relinkVideoEditMedia(id, 'unbound')
  expect(owner.document.media[0]).toMatchObject({ path: newPath, assetContent: { contentIdentity: 'c'.repeat(64) }, sourceRevision: expect.any(String) })
  expect(owner.document.media[0].assetId).toBeUndefined(); expect(close).toHaveBeenCalledOnce()
  undoVideoEdit(id); expect(owner.document.media).toEqual(baseline.media)
})

it('图片探测期间替换文件仍拒绝并释放位图，不把另一文件类型的身份存入文档', async () => {
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
  const close = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => {
    vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValue({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'b'.repeat(64) })
    return { width: 64, height: 64, close }
  }))
  await expect(inspectVideoEditMedia(resolve('fixture', 'changing-image.png'))).rejects.toThrow('素材探测期间已改变')
  expect(close).toHaveBeenCalledOnce()
})

it('纯声音容器以实际媒体种类保存身份，探测前后仍比较同一命名空间', async () => {
  const owner = await createLegacyTrackVideoEditProject()
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  video.audioOnly = true; video.hasAudio = true
  const inspect = vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementation(async (_path, kind) => ({ sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: (kind === 'audio' ? 'c' : 'a').repeat(64) }))
  const sourcePath = resolve('fixture', 'audio-only.mp4')
  await importVideoEditSources(owner.document.id, [{ path: sourcePath }])
  expect(owner.document.media[0]).toMatchObject({ kind: 'audio', assetContent: { contentIdentity: 'c'.repeat(64) } })
  expect(inspect.mock.calls.map(call => call[1])).toEqual(['video', 'audio', 'video', 'audio'])
})
