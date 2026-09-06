import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditAnnotationLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3'
import { renderImageEditorViewportThumbnailV3, renderImageEditorThumbnailV3 } from './viewportThumbnailV3'
import type { ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'
import type { ImageEditorManagedPreviewResultV3 } from './imageEditorPreviewResultLeaseV3'

afterEach(() => { vi.unstubAllGlobals() })

function fixture() {
  const document = createImageEditDocumentV3({ width: 2048, height: 1024 })
  const drawImage = vi.fn(), convertToBlob = vi.fn(async () => new Blob(['pixels'], { type: 'image/webp' }))
  const sizes: number[][] = []
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(width: number, height: number) { sizes.push([width, height]) }
    getContext() { return { drawImage } }
    convertToBlob = convertToBlob
  })
  const bitmap = { width: 256, height: 256, close: vi.fn() } as unknown as ImageBitmap
  const result: ImageEditorManagedViewportCompositeV3 = {
    documentId: document.id, revision: document.revision, geometry: document.geometry,
    renderGeneration: 1, cameraSequence: 0, geometryHash: 'geometry', viewportKey: 'thumbnail',
    coverage: 'document', mip: 2, documentWidth: 2048, documentHeight: 1024, diagnostics: [],
    tiles: [{ bitmap, outputRect: { x: 0, y: 0, width: 256, height: 256 } },
      { bitmap, outputRect: { x: 256, y: 0, width: 256, height: 256 } }], release: vi.fn(),
  }
  const client = { render: vi.fn(async () => result) }
  return { document, client, result, bitmap, drawImage, convertToBlob, sizes }
}

describe('缩略图单向复用视口成品', () => {
  it.each(['annotation', 'empty-brush'])('%s 无图片源仍保留原有缩略图路径，不要求不存在的源金字塔', async (kind) => {
    const value = fixture()
    value.document.layers = [kind === 'annotation' ? createImageEditAnnotationLayerV3('annotation', '标注')
      : createImageEditRasterLayerV3('empty', '空画笔')]
    const release = vi.fn(), dispose = vi.fn()
    const plain = { render: vi.fn(async (): Promise<ImageEditorManagedPreviewResultV3> => ({
      kind: 'url', url: 'blob:thumbnail-test', width: 512, height: 256, diagnostics: [],
      thumbnail: { width: 512, height: 256, bytes: new ArrayBuffer(8), mediaType: 'image/webp' }, release })), dispose }
    const factory = vi.fn(() => plain)
    const result = await renderImageEditorThumbnailV3(value.client, factory, value.document, [], new AbortController().signal)
    expect(factory).toHaveBeenCalledOnce()
    expect(value.client.render).not.toHaveBeenCalled()
    expect(result.bytes.byteLength).toBe(8)
    expect(release).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('含图片源失败不会回到不可表达源几何的旧proxy', async () => {
    const value = fixture()
    value.document.layers = [createImageEditRasterLayerV3('image', '图片', `sha256:${'1'.repeat(64)}`)]
    value.client.render.mockRejectedValueOnce(new Error('视口读取失败'))
    const factory = vi.fn(() => { throw new Error('不应进入旧proxy') })
    await expect(renderImageEditorThumbnailV3(value.client, factory, value.document, [], new AbortController().signal))
      .rejects.toThrow('视口读取失败')
    expect(factory).not.toHaveBeenCalled()
  })

  it('按整张输出尺寸拼接受管瓦片，既不拉伸原图也不重写文档几何', async () => {
    const value = fixture(), geometry = structuredClone(value.document.geometry)
    const thumbnail = await renderImageEditorViewportThumbnailV3(value.client, value.document, [], new AbortController().signal)
    expect(value.client.render).toHaveBeenCalledWith(expect.objectContaining({ document: value.document,
      coverage: 'document', analysisRequested: true, preferredMip: 2,
      viewport: { documentX: 0, documentY: 0, width: 512, height: 256, zoom: 0.25, devicePixelRatio: 1 } }))
    expect(value.sizes).toEqual([[512, 256]])
    expect(value.drawImage.mock.calls).toEqual([[value.bitmap, 0, 0, 256, 256], [value.bitmap, 256, 0, 256, 256]])
    expect(value.result.release).toHaveBeenCalledOnce()
    expect(value.document.geometry).toEqual(geometry)
    expect(thumbnail).toMatchObject({ documentId: value.document.id, mediaType: 'image/webp', extension: 'webp' })
  })

  it('场景取消后的迟到成品只释放，不编码或发布旧缩略图', async () => {
    const value = fixture(), controller = new AbortController()
    value.client.render.mockImplementationOnce(async () => { controller.abort(); return value.result })
    await expect(renderImageEditorViewportThumbnailV3(value.client, value.document, [], controller.signal)).rejects.toThrow()
    expect(value.result.release).toHaveBeenCalledOnce()
    expect(value.convertToBlob).not.toHaveBeenCalled()
  })

  it('编码失败释放受管位图且明确拒绝，不退回旧全图proxy', async () => {
    const value = fixture()
    value.convertToBlob.mockRejectedValueOnce(new Error('编码失败'))
    await expect(renderImageEditorViewportThumbnailV3(value.client, value.document, [], new AbortController().signal)).rejects.toThrow('编码失败')
    expect(value.client.render).toHaveBeenCalledOnce()
    expect(value.result.release).toHaveBeenCalledOnce()
  })
})
