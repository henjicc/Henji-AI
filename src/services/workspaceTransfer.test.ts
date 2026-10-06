// @vitest-environment jsdom
import { createCanvasTestProject, readCanvasTestProject, setCanvasTestProjectState } from '@/tests/canvasProjectFixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Blob as NativeBlob } from 'node:buffer'
import path from 'node:path'
import { getPlatform } from '@/platform/runtime'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { useCanvasStore } from '@/stores/canvasStore'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { addCanvasNode, undoCanvasChange } from '@/features/canvas/application/canvasApplicationService'
import { appendVideoEditMedia, appendVideoEditClip, closeVideoEditProject, createVideoEditProject, editVideoProject, listVideoEditInstances, requireVideoEditInstance, setVideoEditView } from '@/features/videoEdit/application/videoEditService'
import { publishVideoEditOutput, type VideoEditOutputReceipt } from '@/features/videoEdit/application/videoEditOutputs'
import type { VideoEditExportOptions } from '@/features/videoEdit/application/videoEditExport'
import { sendVideoEditToCanvas, videoEditClipTransferSnapshot } from './workspaceTransfer'

// Only pixels/encoder and native storage are replaced. Assets, PAL path handling,
// canvas persistence/history and the public capability execute their production code.
const pixel = vi.hoisted(() => ({ trial: vi.fn() }))
const encoder = vi.hoisted(() => ({ export: vi.fn(), output: undefined as VideoEditOutputReceipt | undefined }))
vi.mock('@/features/videoEdit/application/videoEditCodeTrial', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), trialVideoEditCodeFrames: pixel.trial }))
vi.mock('@/features/videoEdit/application/videoEditExport', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), exportVideoEdit: encoder.export, videoEditExportTask: () => ({ output: encoder.output }) }))
vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class { async getPrimaryVideoTrack() { return null } async getPrimaryAudioTrack() { return null } async computeDuration() { return 0 } dispose() {} } }))

const mediaRoot = path.resolve(path.sep, 'workspace-transfer-media')
const assets = new Map<string, AssetRecord>()
const content = { sizeBytes: 4, fileModifiedAt: 1, contentIdentity: 'd'.repeat(64) }
const drawn: number[][] = []
let canvasId: string
beforeEach(async () => {
  installHarnessNativeStorage(); assets.clear(); drawn.length = 0
  useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  canvasId = await createCanvasTestProject('流转目标')
  pixel.trial.mockReset().mockImplementation(async (frames: Array<{ document: VideoEditComposition }>) => ({ width: frames[0].document.width, height: frames[0].document.height, close: vi.fn() }))
  encoder.output = undefined
  encoder.export.mockReset().mockImplementation(async (id: string, file: string, _background: boolean, _signal: AbortSignal, _loudness: unknown, options: VideoEditExportOptions) => {
    encoder.output = await publishVideoEditOutput({ owner: requireVideoEditInstance(id), sequenceId: options.snapshot.id, revision: options.snapshot.revision, path: file, name: '片段', kind: options.settings.format === 'wav' ? 'audio' : 'video' })
    return file
  })
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage: (_image: unknown, _x: number, _y: number, w: number, h: number) => drawn.push([w, h]) } }
    async convertToBlob() { return new NativeBlob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) }
  })
  const platform = getPlatform()
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue(path.join(mediaRoot, 'project.henji-video'))
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.fs, 'mkdir').mockResolvedValue(undefined)
  vi.spyOn(platform.system.paths, 'dirname').mockImplementation(async value => path.dirname(value))
  vi.spyOn(platform.system.paths, 'join').mockImplementation(async (...parts) => path.join(...parts))
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.image, 'persistImageBinary').mockImplementation(async () => path.join(mediaRoot, `frame-${drawn.length}.png`))
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue(content)
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => {
    const existing = [...assets.values()].find(value => value.filePath === input.filePath)
    if (existing) return existing
    const size = input.mediaType === 'image' ? drawn.at(-1)! : [1920, 1080]
    const value: AssetRecord = { id: `asset-${assets.size + 1}`, filePath: input.filePath, mediaType: input.mediaType, displayName: input.displayName ?? '片段', displayUrl: 'henji-media://local/display-only', source: input.source, mimeType: input.mediaType === 'image' ? 'image/png' : 'video/mp4', ...content, width: size[0], height: size[1], durationSeconds: input.mediaType === 'image' ? 0 : 1, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    assets.set(value.id, value); return value
  })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => structuredClone(assets.get(id)!))
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  setCanvasTestProjectState({ currentProjectId: null, currentProject: null })
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
})

it('正式助手发送完整节目帧到指定画布：裸本地引用经 PAL、保存读回与一次撤销', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, width: 4096, height: 2160 })) }))
  setVideoEditView(id, { frame: 7 })
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('send_video_edit_to_canvas', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }, canvasRef: { kind: 'canvas.document', id: canvasId }, selection: { kind: 'frame', frame: 42 } })
    expect(result).toMatchObject({ nodeRef: { kind: 'canvas.node' }, assetRef: { kind: 'asset' }, verification: { verified: true } })
    expect(pixel.trial.mock.calls[0][0][0]).toMatchObject({ frame: 42 })
    expect(drawn).toEqual([[4096, 2160]])
    const node = readCanvasTestProject(canvasId)!.nodes[0]
    expect(node).toMatchObject({ type: CANVAS_NODE_TYPES.upload, data: { imageUrl: path.join(mediaRoot, 'frame-1.png'), aspectRatio: '4096:2160' } })
    expect(getPlatform().media.allowRoot).toHaveBeenCalledWith(mediaRoot)
    expect(owner.frame).toBe(7)
    expect(useCanvasStore.getState().history.past).toHaveLength(1)
    await undoCanvasChange(canvasId, String(result.undoRef))
    expect(readCanvasTestProject(canvasId)!.nodes).toHaveLength(0)
    expect(assets.size).toBe(1) // 撤销节点不删除其他工作区可以继续使用的媒体。
  } finally { app.dispose() }
})

it('发送独立视频保留裁切、速度、关键帧与链接音频，并导出为正式视频输入', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  appendVideoEditMedia(id, { id: 'movie', name: '原片', path: path.join(mediaRoot, 'source.mp4'), kind: 'video', width: 1920, height: 1080, durationSeconds: 10, hasAudio: true })
  appendVideoEditClip(id, 'movie', { frame: 30, track: 1 })
  const clipId = owner.document.sequences[0].clips[0].id
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.flatMap(clip => clip.id !== clipId ? [clip] : [{ ...clip, duration: 60, sourceInUs: 1_000_000, speed: { numerator: 2, denominator: 1 }, linkId: 'pair', curves: { opacity: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 30, value: 1, interpolation: 'linear' }] } }, { ...clip, id: 'sound', kind: 'audio', track: 0, sourceComponent: 'audio', linkId: 'pair' }]) })) }))
  const prepared = videoEditClipTransferSnapshot(owner.document, owner.activeSequenceId, clipId)
  expect(prepared.range).toEqual({ startFrame: 30, endFrame: 90 })
  expect(prepared.snapshot.clips).toHaveLength(2)
  expect(prepared.snapshot.clips[0]).toMatchObject({ sourceInUs: 1_000_000, speed: { numerator: 2, denominator: 1 }, curves: { opacity: expect.any(Array) } })
  const result = await sendVideoEditToCanvas({ projectId: id, sequenceId: owner.activeSequenceId, canvasId, source: { kind: 'clip', clipId } })
  expect(encoder.export).toHaveBeenCalledWith(id, expect.stringMatching(/clip-.*\.mp4$/), false, expect.any(AbortSignal), undefined, expect.objectContaining({ snapshot: prepared.snapshot, range: prepared.range, settings: expect.objectContaining({ width: 1920, height: 1080, format: 'mp4' }) }))
  expect(readCanvasTestProject(canvasId)!.nodes[0]).toMatchObject({ type: CANVAS_NODE_TYPES.videoUpload, data: { videoUrl: assets.get(result.assetRef.id)!.filePath } })
  expect(pixel.trial).not.toHaveBeenCalled()
})

it.each(['source', 'canvas'] as const)('取帧期间 %s 修改时拒绝迟到新增，保留已有修改与输出', async changed => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  pixel.trial.mockImplementationOnce(async (frames: Array<{ document: VideoEditComposition }>) => {
    if (changed === 'source') editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, name: '后来修改' })) }))
    else await addCanvasNode({ projectId: canvasId, nodeType: CANVAS_NODE_TYPES.upload, placement: { mode: 'viewport_center' } })
    return { width: frames[0].document.width, height: frames[0].document.height, close: vi.fn() }
  })
  await expect(sendVideoEditToCanvas({ projectId: id, sequenceId: owner.activeSequenceId, canvasId, source: { kind: 'frame', frame: 0 } })).rejects.toThrow()
  expect(readCanvasTestProject(canvasId)!.nodes).toHaveLength(changed === 'source' ? 0 : 1)
  expect(assets.size).toBe(1)
})

it('外来片段引用与取消均拒绝落位，不触发像素或文件生成', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const app = createApplicationHarness()
  try {
    const rejected = await app.call('send_video_edit_to_canvas', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }, canvasRef: { kind: 'canvas.document', id: canvasId }, selection: { kind: 'clip', clipRef: { kind: 'video_edit.clip', id: 'another:clip' } } })
    expect(JSON.stringify(rejected)).toContain('必须属于来源剪辑')
    const controller = new AbortController(); controller.abort()
    await expect(sendVideoEditToCanvas({ projectId: id, sequenceId: owner.activeSequenceId, canvasId, source: { kind: 'frame', frame: 0 } }, controller.signal)).rejects.toThrow()
    expect(pixel.trial).not.toHaveBeenCalled(); expect(encoder.export).not.toHaveBeenCalled()
    expect(readCanvasTestProject(canvasId)!.nodes).toHaveLength(0)
  } finally { app.dispose() }
})
