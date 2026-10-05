// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { createCameraStageRenderTaskRef } from '@/features/cameraStage/application/cameraStageRenderCapabilityAdapter'
import { prepareVideoEditCreativeResult, type VideoEditCreativeSourceRequest } from './videoEditCreativeSources'

// Producer services and native I/O are the only replaced boundaries; adapter pinning,
// rechecks, library collection order and release rules are the code under test.
const producers = vi.hoisted(() => ({
  generation: vi.fn(), canvas: vi.fn(), loadImage: vi.fn(), materialize: vi.fn(), spec: vi.fn(), render: vi.fn(),
  exportAudio: vi.fn(), loadAudio: vi.fn(), flushAudio: vi.fn(), audioInstance: vi.fn(), addAsset: vi.fn(), inspect: vi.fn(),
}))
vi.mock('@/features/generation/application/generationResultSource', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), readGenerationResultMedia: producers.generation }))
vi.mock('@/features/canvas/application/canvasQueryService', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), readPersistedCanvasProjectSnapshot: producers.canvas }))
vi.mock('@/features/canvas/application/graphOutputResolver', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), getGraphNodeMediaOutputs: (node: { data: { testOutput?: unknown } }) => node.data.testOutput ? [node.data.testOutput] : [] }))
vi.mock('@/commands/imageEditorV3', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), loadImageEditorV3Document: producers.loadImage, createImageEditorV3RequestId: (prefix: string) => `${prefix}-1` }))
vi.mock('@/commands/imageEditorV3Export', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), materializeImageEditorV3StandaloneRaster: producers.materialize }))
vi.mock('@/features/imageMark/standalone/imageMarkV3RasterExport', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), createImageMarkV3RasterExportSpec: producers.spec }))
vi.mock('@/features/imageEdit/v3/export', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), prepareImageEditorV3ExportRender: vi.fn(), renderImageEditorV3ExportTilesWithGpu: producers.render }))
vi.mock('@/features/audioEdit/application/audioEditApplicationService', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), exportAudioEdit: producers.exportAudio }))
vi.mock('@/features/audioEdit/application/audioEditProjectInstances', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), loadAudioEditProject: producers.loadAudio, flushAudioEditProject: producers.flushAudio, getAudioEditProjectInstance: producers.audioInstance }))
vi.mock('@/features/assets/services/assetCollectionService', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), addMediaReferenceToLibrary: producers.addAsset, resolveLocalAssetPath: (value: string) => value }))
vi.mock('@/features/assets/application/assetApplicationService', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), assetApplicationService: { inspect: producers.inspect } }))

const hash = 'a'.repeat(64)
const content = { sizeBytes: 2048, fileModifiedAt: 1000, contentIdentity: hash }
let library: Map<string, AssetRecord>
function record(input: { filePath: string; mediaType: AssetRecord['mediaType']; source: AssetRecord['source']; displayName?: string }): AssetRecord {
  return { id: `asset-${library.size + 1}`, mediaType: input.mediaType, displayName: input.displayName ?? '结果', filePath: input.filePath, displayUrl: '', source: input.source, mimeType: null, ...content, width: input.mediaType === 'audio' ? null : 1920, height: input.mediaType === 'audio' ? null : 1080, durationSeconds: input.mediaType === 'image' ? 0 : 3, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
}
const options = (assertTarget = vi.fn(), signal?: AbortSignal) => ({ assertTarget, signal })
function canvasNode(id: string, data: Record<string, unknown>) {
  return { id, type: 'exportImage', position: { x: 0, y: 0 }, data: { generationOutputCommitId: 'commit-1', generationOutputDescriptor: { version: 1, outputId: 'out-1', mediaType: 'image' }, testOutput: { kind: 'image', url: 'D:/canvas/result.png' }, ...data } }
}
beforeEach(() => {
  installHarnessNativeStorage(); library = new Map()
  for (const mock of Object.values(producers)) mock.mockReset()
  producers.addAsset.mockImplementation(async (input: Parameters<typeof record>[0]) => { const value = record(input); library.set(value.id, value); return value })
  producers.inspect.mockImplementation(async (id: string) => structuredClone(library.get(id)!))
  const platform = getPlatform()
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/results')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue(content)
  vi.spyOn(platform.image, 'releaseManagedGenerationMedia').mockResolvedValue(undefined)
})
afterEach(() => { vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('生成结果固定 outputIndex 与本地落盘文件；完成后路径变化不认证新结果', async () => {
  producers.generation.mockResolvedValue({ mediaType: 'image', source: 'D:/results/second.png', name: '第二张' })
  const source: VideoEditCreativeSourceRequest = { kind: 'generation.result', id: 'history-1', outputIndex: 1 }
  const first = await prepareVideoEditCreativeResult(source, options())
  expect(producers.generation).toHaveBeenCalledWith('history-1', undefined, { outputIndex: 1, localOnly: true })
  expect(first).toMatchObject({ asset: { filePath: 'D:/results/second.png', source: 'generated' }, origin: { kind: 'generation.result', id: 'history-1' } })
  expect(first.origin.version).toMatch(/^[a-f0-9]{64}$/)
  expect((await prepareVideoEditCreativeResult(source, options())).origin.version).toBe(first.origin.version)
  producers.generation.mockResolvedValueOnce({ mediaType: 'image', source: 'D:/results/second.png', name: '第二张' }).mockResolvedValue({ mediaType: 'image', source: 'D:/results/other.png', name: '第二张' })
  await expect(prepareVideoEditCreativeResult(source, options())).rejects.toThrow('已改变')
  producers.generation.mockResolvedValue({ mediaType: 'image', source: 'https://cdn.example/remote.png', name: '远程' })
  await expect(prepareVideoEditCreativeResult(source, options())).rejects.toThrow('尚未保存为本地文件')
})

it('画布节点首次读取固定完成身份，之后重新生成或仍在生成都拒绝', async () => {
  producers.canvas.mockResolvedValue({ nodes: [canvasNode('n1', {})] })
  const result = await prepareVideoEditCreativeResult({ kind: 'canvas.node', projectId: 'canvas', nodeId: 'n1' }, options())
  expect(result.origin).toMatchObject({ kind: 'canvas.node', id: 'canvas:n1' }); expect(result.asset.source).toBe('canvas')
  producers.canvas.mockResolvedValueOnce({ nodes: [canvasNode('n1', {})] }).mockResolvedValue({ nodes: [canvasNode('n1', { generationOutputCommitId: 'commit-2' })] })
  await expect(prepareVideoEditCreativeResult({ kind: 'canvas.node', projectId: 'canvas', nodeId: 'n1' }, options())).rejects.toThrow('已改变')
  producers.canvas.mockResolvedValue({ nodes: [canvasNode('n1', { isGenerating: true })] })
  await expect(prepareVideoEditCreativeResult({ kind: 'canvas.node', projectId: 'canvas', nodeId: 'n1' }, options())).rejects.toThrow('正式完成结果')
  expect(producers.addAsset).toHaveBeenCalledTimes(1)
})

it('三维结果在后台任务释放后仍读持久结果节点，回执不符或多份结果拒绝', async () => {
  const identity = { version: 1 as const, canvasProjectId: 'canvas', nodeId: 'stage', requestId: 'req-1', cameraStageDocumentId: 'stage-project', resolutionPreset: '1080p' as const, outputKind: 'video' as const }
  const taskRef = createCameraStageRenderTaskRef(identity).id
  const receipt = { version: 1, requestId: 'req-1', canvasProjectId: 'canvas', nodeId: 'stage', cameraStageDocumentId: 'stage-project', resolutionPreset: '1080p', outputKind: 'video' }
  const node = (patch: Record<string, unknown> = {}) => canvasNode('result', { generationOutputCommitId: 'camera-stage-render:req-1', generationOutputDescriptor: { version: 1, outputId: 'o', mediaType: 'video' }, testOutput: { kind: 'video', url: 'D:/renders/stage.mp4' }, cameraStageRenderReceipt: receipt, ...patch })
  producers.canvas.mockResolvedValue({ nodes: [node()] })
  const result = await prepareVideoEditCreativeResult({ kind: 'camera_stage.render_task', taskRef }, options())
  expect(result).toMatchObject({ asset: { filePath: 'D:/renders/stage.mp4', mediaType: 'video', source: 'camera-stage' }, origin: { kind: 'camera_stage.render_task', id: 'req-1' } })
  producers.canvas.mockResolvedValue({ nodes: [node({ cameraStageRenderReceipt: { ...receipt, resolutionPreset: '720p' } })] })
  await expect(prepareVideoEditCreativeResult({ kind: 'camera_stage.render_task', taskRef }, options())).rejects.toThrow('不一致')
  producers.canvas.mockResolvedValue({ nodes: [node(), { ...node(), id: 'copy' }] })
  await expect(prepareVideoEditCreativeResult({ kind: 'camera_stage.render_task', taskRef }, options())).rejects.toThrow('多个持久结果')
})

it('图片编辑固定版本独立渲染；未被资产引用的渲染失败时释放，高位深明确拒绝', async () => {
  const fingerprint = `sha256:${'b'.repeat(64)}`
  producers.loadImage.mockResolvedValue({ documentRef: 'image-edit-v3:doc', revision: 4, sourceFingerprint: fingerprint, document: { id: 'doc' }, resources: [] })
  producers.spec.mockReturnValue({ format: 'png8', description: { width: 1920, height: 1080 } })
  producers.render.mockReturnValue('tiles')
  producers.materialize.mockResolvedValue({ publication: 'standalone-image', documentRef: 'image-edit-v3:doc', revision: 4, sourceFingerprint: fingerprint, format: 'png8', width: 1920, height: 1080, imagePath: 'D:/managed/edit.png', createdFilePaths: ['D:/managed/edit.png'] })
  const source: VideoEditCreativeSourceRequest = { kind: 'image_edit.document', documentRef: 'image-edit-v3:doc', revision: 4 }
  const result = await prepareVideoEditCreativeResult(source, options())
  expect(result.asset).toMatchObject({ filePath: 'D:/managed/edit.png', mediaType: 'image' }); expect(result.origin.id).toBe('image-edit-v3:doc')
  expect(producers.materialize).toHaveBeenCalledWith(expect.objectContaining({ revision: 4, sourceFingerprint: fingerprint, format: 'png8', tiles: 'tiles' }), undefined)
  producers.addAsset.mockRejectedValueOnce(new Error('资产库不可写'))
  await expect(prepareVideoEditCreativeResult(source, options())).rejects.toThrow('资产库不可写')
  expect(getPlatform().image.releaseManagedGenerationMedia).toHaveBeenCalledWith(['D:/managed/edit.png'])
  vi.mocked(getPlatform().image.releaseManagedGenerationMedia).mockClear()
  producers.inspect.mockRejectedValueOnce(new Error('检查失败'))
  await expect(prepareVideoEditCreativeResult(source, options())).rejects.toThrow('检查失败')
  expect(getPlatform().image.releaseManagedGenerationMedia).not.toHaveBeenCalled()
  await expect(prepareVideoEditCreativeResult({ ...source, revision: 5 }, options())).rejects.toThrow('已改变')
  producers.spec.mockReturnValue({ format: 'bigtiff', description: { width: 1920, height: 1080 } }); producers.materialize.mockClear()
  await expect(prepareVideoEditCreativeResult(source, options())).rejects.toThrow('导出为 PNG')
  expect(producers.materialize).not.toHaveBeenCalled()
})

it('口播导出新 WAV/SRT 并读取剪后字幕；取消转发到原任务，选择已有文件拒绝', async () => {
  const owner = { document: { name: '口播.wav', revision: 3, source: { identity: 'voice', sampleRate: 48000 }, vstEnabled: false }, version: 2 }
  producers.loadAudio.mockResolvedValue(owner); producers.audioInstance.mockReturnValue(owner); producers.flushAudio.mockResolvedValue(undefined)
  const platform = getPlatform()
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/voice/cut.wav')
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(false)
  vi.spyOn(platform.system.fs, 'readFile').mockResolvedValue(new TextEncoder().encode('1\n00:00:00,500 --> 00:00:01,000\n剪后字幕\n'))
  const cancel = vi.spyOn(platform.audioEdit, 'cancelTask').mockResolvedValue(undefined)
  producers.exportAudio.mockImplementation(async (input: { targetPath: string; subtitleTargetPath: string }) => ({ audioPath: input.targetPath, subtitlePath: input.subtitleTargetPath, durationFrames: 144000 }))
  const result = await prepareVideoEditCreativeResult({ kind: 'audio_edit.project', projectId: 'voice' }, options())
  expect(result).toMatchObject({ asset: { filePath: 'D:/voice/cut.wav', mediaType: 'audio' }, origin: { kind: 'audio_edit.project', id: 'voice' } })
  expect(result.captions).toContain('剪后字幕')
  expect(producers.exportAudio).toHaveBeenCalledWith(expect.objectContaining({ format: 'wav', targetPath: 'D:/voice/cut.wav', subtitleTargetPath: 'D:/voice/cut.srt' }))
  const controller = new AbortController()
  producers.exportAudio.mockImplementationOnce(() => new Promise((_, reject) => { controller.signal.addEventListener('abort', () => reject(new DOMException('取消', 'AbortError'))) ; queueMicrotask(() => controller.abort()) }))
  await expect(prepareVideoEditCreativeResult({ kind: 'audio_edit.project', projectId: 'voice' }, options(vi.fn(), controller.signal))).rejects.toThrow()
  expect(cancel).toHaveBeenCalledTimes(1)
  vi.mocked(platform.system.fs.exists).mockResolvedValue(true); producers.exportAudio.mockClear()
  await expect(prepareVideoEditCreativeResult({ kind: 'audio_edit.project', projectId: 'voice' }, options())).rejects.toThrow('新的 WAV')
  vi.mocked(platform.system.dialog.save).mockResolvedValue(null)
  await expect(prepareVideoEditCreativeResult({ kind: 'audio_edit.project', projectId: 'voice' }, options())).rejects.toThrow('已取消')
  expect(producers.exportAudio).not.toHaveBeenCalled()
})

it('目标失效时不再收录资产：原结果保留在生产方', async () => {
  producers.generation.mockResolvedValue({ mediaType: 'video', source: 'D:/results/clip.mp4', name: '视频' })
  let valid = true
  const assertTarget = vi.fn(() => { if (!valid) throw new Error('原剪辑工程已有修改') })
  vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockImplementationOnce(async () => { valid = false; return content })
  await expect(prepareVideoEditCreativeResult({ kind: 'generation.result', id: 'h', outputIndex: 0 }, options(assertTarget))).rejects.toThrow('已有修改')
  expect(producers.addAsset).not.toHaveBeenCalled()
})
