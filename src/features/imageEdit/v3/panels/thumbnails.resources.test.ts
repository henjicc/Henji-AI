import { afterEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE } from '../application/imageEditorResourceDescriptorsV3'
import { ImageEditThumbnailsV3 } from './thumbnails'

const mock = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn() }))
vi.mock('../execution/imageEditorPreviewClientV3', () => ({ ImageEditorPreviewClientV3: class { render = mock.render; dispose = mock.dispose } }))
vi.mock('../execution/imageEditorSessionResourceBudgetV3', () => ({ acquireImageEditorSessionResourceBudgetV3: () => ({ release: vi.fn() }) }))
afterEach(() => { vi.clearAllMocks() })

it('图层及历史缩略图根据其请求文档的权威用途读取命令资源，不依赖宿主初始描述', async () => {
  const source = `sha256:${'a'.repeat(64)}`, mask = `sha256:${'b'.repeat(64)}`
  const document = createImageEditDocumentV3({ width: 512, height: 512 })
  const layer = createImageEditRasterLayerV3('pasted', '粘贴图片', source)
  layer.mask = { ...createImageEditSparseMaskReferenceV3('selected', false, 0), tiles: { '0/0/0': mask } }
  document.layers = [layer]
  const bus = new ImageEditCommandBusV3(document, { resourceByteSizes: { [source]: 4096, [mask]: 128 } })
  const thumbnails = new ImageEditThumbnailsV3({ sessionId:'thumbnail-resources', historyPort:bus, historyResourceDescriptors:[] })
  mock.render.mockRejectedValue(new Error('stop after checking request'))
  try {
    for (const request of [() => thumbnails.readDocument(document, 'layer', new AbortController().signal),
      () => thumbnails.read(0, 'history', new AbortController().signal)]) {
      await expect(request()).rejects.toThrow('stop after checking request')
      expect(mock.render.mock.calls.at(-1)?.[0].resourceDescriptors).toEqual([
        { resourceRef:source, byteLength:4096, mediaType:null },
        { resourceRef:mask, byteLength:128, mediaType:IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE },
      ])
    }
  } finally { thumbnails.dispose(); bus.dispose() }
})
