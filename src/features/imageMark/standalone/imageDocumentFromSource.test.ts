/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createImageEditAnnotationLayerV3, createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { parseImageEditDocumentV3, stringifyImageEditDocumentV3 } from '@/core/imageEdit/v3/documentCodec'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { prepareImageEditManagedSessionV3 } from '@/features/imageEdit/v3/application/imageEditManagedSessionV3'
import { prepareCanvasEditV3Session } from '@/features/canvas/imageEditV3/canvasEditV3Session'
import { createImageDocumentFromSource } from './imageDocumentFromSource'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage, readHarnessImageEditDocument } from '@/tests/harnessNativeStorage'
import { imageEditTestManagedSource, IMAGE_EDIT_TEST_SOURCE_REF } from '@/tests/imageEditV3SourceFixture'
import { annotationImpulse, collectPixels, type FakeImage } from '@/features/imageEdit/v3/export/renderExportTestFixtures'
import { BLACK_HEX } from '@/core/theme/colorTokens'
const io = vi.hoisted(() => ({ ingest: vi.fn(), create: vi.fn() }))
vi.mock('@/commands/imageEditorV3', async importOriginal => ({ ...await importOriginal<typeof import('@/commands/imageEditorV3')>(), ingestImageEditorV3Source: io.ingest }))
vi.mock('@/features/imageEdit/documents/imageDocumentRuntime', () => ({ createImageDocument: io.create }))
beforeEach(() => { vi.clearAllMocks(); installHarnessNativeStorage(); io.ingest.mockReset().mockResolvedValue(imageEditTestManagedSource(64, 48)); io.create.mockImplementation(async (options: { documentId: string }) => ({ id: options.documentId })) })
afterEach(uninstallHarnessNativeStorage)
it('新建空白直接保存 V3 初始文档，外来 V3 图层和几何不经旧版本中转', async () => {
  const blank = await createImageDocumentFromSource({ url: 'C:/blank.png', blank: true })
  expect(readHarnessImageEditDocument(blank.id)?.document).toMatchObject({ version: 6, revision: 0, geometry: { width: 64, height: 48 }, layers: [{ type: 'raster', source: { kind: 'resource', resourceId: IMAGE_EDIT_TEST_SOURCE_REF } }] })
  expect(io.create).toHaveBeenCalledWith({ documentId: blank.id, emptyUntilRevision: 0 }, { kind: 'user' })
  const incoming = createImageEditDocumentV3({ width: 64, height: 48, sourceResourceId: IMAGE_EDIT_TEST_SOURCE_REF })
  incoming.layers.push(createImageEditAnnotationLayerV3('handoff', '标注'))
  incoming.geometry.orientation.rotate = 90; incoming.revision = 4
  io.ingest.mockRejectedValueOnce(new Error('原图地址已失效'))
  const opened = await createImageDocumentFromSource({ url: 'C:/input.png', document: incoming })
  expect(readHarnessImageEditDocument(opened.id)?.document).toMatchObject({ version: 6, revision: 0, geometry: incoming.geometry, layers: incoming.layers })
  expect(incoming.revision).toBe(4)
  expect(io.ingest).toHaveBeenCalledTimes(1)
})
it('查看器、画布、工具箱入口对同一图片执行朝向/裁剪/标记，保存 codec 与分块导出像素一致', async () => {
  const repository = new ImageEditorV3CommandRepository()
  const quick = await prepareImageEditManagedSessionV3({ sourceImageUrl: 'C:/input.png', repository })
  const canvas = await prepareCanvasEditV3Session({ sourceImageUrl: 'C:/input.png', toolOptions: {}, repository })
  const toolbox = await createImageDocumentFromSource({ url: 'C:/input.png' })
  const documents = [quick.document, canvas.document, readHarnessImageEditDocument(toolbox.id)!.document]
  const image: FakeImage = { width: 64, height: 48, pixel: (x, y) => [x * 4, y * 5, 0, 255] }
  const outputs: Uint8Array[] = []
  const savedGeometry: unknown[] = []
  const savedMarks: unknown[] = []
  for (const document of documents) {
    const bus = new ImageEditCommandBusV3(document)
    try {
      bus.dispatch({ type: 'document.update-output-geometry', commandId: 'geometry', expectedRevision: 0, orientation: { rotate: 90, mirrored: true }, crop: { x: 1, y: 2, width: 32, height: 40 } })
      const layer = createImageEditAnnotationLayerV3('marks', '标注')
      bus.dispatch({ type: 'layer.add', commandId: 'layer', expectedRevision: 1, layer, parentId: null, index: 1 })
      bus.dispatch({ type: 'annotation.add', commandId: 'mark', expectedRevision: 2, layerId: layer.id, index: 0, annotation: { id: 'mark', type: 'rect', x: 3, y: 2, width: 2, height: 2, stroke: BLACK_HEX, lineWidth: 1 } })
      const snapshot = bus.getPersistenceSnapshot()
      await repository.save(snapshot.document, { expectedRevision: 0, history: snapshot.history })
      const stored = readHarnessImageEditDocument(document.id)!.document
      const decoded = parseImageEditDocumentV3(stringifyImageEditDocumentV3(stored))
      expect(decoded).toEqual(snapshot.document)
      savedGeometry.push(decoded.geometry); savedMarks.push(decoded.layers[1])
      // Annotation rasterization uses a deterministic opaque mark; the real compositor handles output geometry and tiles.
      const pixelOutput = await collectPixels(decoded, 16, new Map([[IMAGE_EDIT_TEST_SOURCE_REF, image]]), annotationImpulse(3, 2))
      expect(pixelOutput).toHaveLength(32 * 40 * 4)
      expect(pixelOutput).toEqual(await collectPixels(decoded, 64, new Map([[IMAGE_EDIT_TEST_SOURCE_REF, image]]), annotationImpulse(3, 2)))
      outputs.push(pixelOutput)
    } finally { bus.dispose() }
  }
  expect(savedGeometry[1]).toEqual(savedGeometry[0]); expect(savedGeometry[2]).toEqual(savedGeometry[0])
  expect(savedMarks[1]).toEqual(savedMarks[0]); expect(savedMarks[2]).toEqual(savedMarks[0])
  expect(outputs[1]).toEqual(outputs[0]); expect(outputs[2]).toEqual(outputs[0])
})
