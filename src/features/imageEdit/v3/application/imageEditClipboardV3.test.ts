// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { createImageEditDocumentV3, createImageEditGroupLayerV3, createImageEditRasterLayerV3, createImageEditTextLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { copyImageEditClipboardV3, pasteImageEditClipboardV3, projectImageEditClipboardLayersV3 } from './imageEditClipboardV3'
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession'
import { executeApplicationCapabilityResult } from '@/features/application-control/capabilities/registry'
import { imageEditV3DocumentRef } from './imageEditDocumentRefs'
import { getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { imageEditClipboardCapability } from '@/core/application-control/domains/imageEdit/imageEditClipboardCapabilities'

const mocks = vi.hoisted(() => ({ clipboardSource: vi.fn(), importMedia: vi.fn(), read: vi.fn(), write: vi.fn(), ingest: vi.fn(), load: vi.fn(), pin: vi.fn(), release: vi.fn(), confirm: vi.fn(), cleanup: vi.fn() }))
vi.mock('@/services/localMediaImport', () => ({ readClipboardImageSource: mocks.clipboardSource, importLocalMedia: mocks.importMedia }))
vi.mock('@/commands/clipboard', () => ({ readClipboardImage: mocks.read }))
vi.mock('@/commands/imageEditorV3', async original => ({ ...await original<typeof import('@/commands/imageEditorV3')>(),
  ingestImageEditorV3Source: mocks.ingest, loadImageEditorV3Document: mocks.load, pinImageEditorV3RepairResources: mocks.pin, releaseImageEditorV3RepairResources: mocks.release }))
vi.mock('@/commands/imageEditorV3Export', () => ({ materializeImageEditorV3StandaloneRaster: vi.fn(async () => ({ imagePath: '/managed/clipboard.png', createdFilePaths: ['/managed/clipboard.png'] })) }))
vi.mock('../export', () => ({ prepareImageEditorV3ExportRender: vi.fn(), renderImageEditorV3ExportTilesWithGpu: vi.fn() }))
vi.mock('./imageEditDocumentInstances', async original => ({ ...await original<typeof import('./imageEditDocumentInstances')>(), findImageEditDocumentInstanceV3: () => ({ persistenceOwner: { confirm: mocks.confirm } }) }))
vi.mock('@/platform/runtime', async original => {
  const runtime = await original<typeof import('@/platform/runtime')>()
  return { ...runtime, getPlatform: () => {
    const platform = runtime.getPlatform()
    return { ...platform, clipboard: { ...platform.clipboard, writeImageFromSource: mocks.write }, image: { ...platform.image, releaseManagedGenerationMedia: mocks.cleanup } }
  } }
})
const ref = `sha256:${'a'.repeat(64)}` as const
beforeEach(() => {
  installHarnessNativeStorage(); vi.clearAllMocks()
  mocks.read.mockResolvedValue({ dataUrl: 'data:image/png;base64,test', name: '截图', origin: 'bitmap' })
  mocks.clipboardSource.mockImplementation(() => mocks.read())
  mocks.ingest.mockResolvedValue({ resource: { resourceRef: ref, byteLength: 1024 }, metadata: { width: 8, height: 6 } })
})
afterEach(uninstallHarnessNativeStorage)
describe('图片剪贴板唯一服务', () => {
  it('大图片路径经统一导入后按原文件路径摄取，保留尺寸与单步撤销', async () => {
    const entry = { path: path.resolve(path.sep, 'media', 'large.png'), mimeType: 'image/png', size: 2 * 1024 ** 3 }
    mocks.clipboardSource.mockResolvedValue(entry)
    mocks.read.mockResolvedValue(null)
    mocks.importMedia.mockResolvedValue({ kind: 'image', fullPath: entry.path })
    const bus = new ImageEditCommandBusV3(createImageEditDocumentV3({ width: 32, height: 16 }))
    const original = bus.getSnapshot().document
    await pasteImageEditClipboardV3(bus)
    expect(mocks.importMedia).toHaveBeenCalledWith(entry, 'image')
    expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'local-path', filePath: entry.path } }), undefined)
    expect(mocks.read).not.toHaveBeenCalled()
    await bus.undo()
    expect(bus.getSnapshot().document.layers).toEqual(original.layers)
  })
  it('正式助手能力执行粘贴并通过通用实体读回图层内容', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 16 }), bus = new ImageEditCommandBusV3(document)
    const dispose = registerPersistedImageEditTestSession('clipboard-capability', bus)
    try {
      const result = await executeApplicationCapabilityResult({ id: 'use_image_edit_clipboard', version: 1, input: { documentRef: imageEditV3DocumentRef(document.id), action: 'paste' } }, { signal: new AbortController().signal, requestId: 'clipboard-capability' })
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (!result.ok) throw new Error(result.error.message)
      expect(result.data.verified).toBe(true)
      const output = imageEditClipboardCapability.outputSchema.parse(result.data)
      const state = await getApplicationReflectionRegistry().readEntity(output.ref, undefined, { exposure: 'assistant', acceptedDataClasses: new Set(['C0','C1']) })
      expect(state.properties['image_edit.layer.name']).toBe('截图')
      await bus.undo(); expect(bus.getSnapshot().document.layers).toEqual(document.layers)
    } finally { dispose() }
  })
  it('外部图片导入正确尺寸的新图层，单次撤销，原图保留', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 16 }); const bus = new ImageEditCommandBusV3(document)
    const original = bus.getSnapshot().document
    const id = await pasteImageEditClipboardV3(bus)
    const layer = bus.getSnapshot().document.layers.at(-1)!
    expect(layer.id).toBe(id); expect(layer.type).toBe('raster')
    expect(layer.transform).toEqual([1,0,0,1,12,5])
    expect(layer.type === 'raster' && layer.rasterCanvasSize).toEqual({ width: 8, height: 6 })
    await bus.undo(); expect(bus.getSnapshot().document.layers).toEqual(original.layers)
  })
  it('无图片和取消不会产生图层命令', async () => {
    const bus = new ImageEditCommandBusV3(createImageEditDocumentV3({ width: 16, height: 16 }))
    const revision = bus.getSnapshot().document.revision
    mocks.read.mockResolvedValue(null); await expect(pasteImageEditClipboardV3(bus)).rejects.toThrow('没有图片')
    mocks.read.mockResolvedValue({ dataUrl: 'data:image/png;base64,test' })
    const abort = new AbortController(); abort.abort()
    await expect(pasteImageEditClipboardV3(bus, abort.signal)).rejects.toThrow()
    expect(bus.getSnapshot().document.revision).toBe(revision)
  })
  it('选择嵌套图层时保留父组变换和蒙版，不复制无关兄弟', () => {
    const group = createImageEditGroupLayerV3('parent','父组'); group.transform = [2,0,0,2,5,8]
    group.children = [createImageEditTextLayerV3('text','文字'), createImageEditRasterLayerV3('other','其他')]
    const projected = projectImageEditClipboardLayersV3([group], new Set(['text']))
    expect(projected[0].transform).toEqual(group.transform)
    expect(projected[0].type === 'group' && projected[0].children.map(layer => layer.id)).toEqual(['text'])
    expect(group.children).toHaveLength(2)
  })
  it('系统位图和内部可编辑内容同源，复制不改历史，连续粘贴生成独立 ID', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 16 }); document.layers = [createImageEditTextLayerV3('text','文字')]
    const bus = new ImageEditCommandBusV3(document)
    mocks.load.mockResolvedValue({ documentRef: `image-edit-v3:${document.id}`, revision: document.revision, sourceFingerprint: ref })
    await copyImageEditClipboardV3(bus, ['text'])
    expect(bus.getSnapshot().document.revision).toBe(document.revision)
    expect(mocks.write).toHaveBeenCalledWith('/managed/clipboard.png')
    expect(mocks.cleanup).toHaveBeenCalledWith(['/managed/clipboard.png'])
    const first = await pasteImageEditClipboardV3(bus), second = await pasteImageEditClipboardV3(bus)
    expect(first).not.toBe(second)
    const layer = bus.getSnapshot().document.layers.at(-1)!
    expect(layer.type === 'group' && layer.children[0].type).toBe('text')
    expect(mocks.ingest).not.toHaveBeenCalled()
  })
})
