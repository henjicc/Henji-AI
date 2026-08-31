import { describe, expect, it } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import {
  createImageEditorV3ResourceByteSizes,
  IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE,
  reconcileImageEditorV3ResourceDescriptors,
} from './imageEditorResourceDescriptorsV3'

const SOURCE = `sha256:${'a'.repeat(64)}` as const
const BRUSH = `sha256:${'b'.repeat(64)}` as const
const STALE = `sha256:${'c'.repeat(64)}` as const

describe('ImageEditor V3 受控资源描述符', () => {
  it('保留文档资源并用持久 brush 返回值补齐 mediaType/byteLength，同时清理不可达项', () => {
    const raster = createImageEditRasterLayerV3('raster', '底图', SOURCE)
    raster.tiles['0/0/0'] = BRUSH
    const document = {
      ...createImageEditDocumentV3({ width: 512, height: 512, documentId: 'metadata' }),
      layers: [raster],
    }
    const descriptors = reconcileImageEditorV3ResourceDescriptors(document, [
      { resourceRef: SOURCE, byteLength: 4_096, mediaType: 'image/png' },
      { resourceRef: STALE, byteLength: 1_024, mediaType: 'image/png' },
    ], [
      { resourceId: BRUSH, byteSize: 128 },
    ])

    expect(descriptors).toEqual([
      { resourceRef: SOURCE, byteLength: 4_096, mediaType: 'image/png' },
      {
        resourceRef: BRUSH,
        byteLength: 128,
        mediaType: IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE,
      },
    ])
    expect(createImageEditorV3ResourceByteSizes(descriptors)).toEqual({
      [SOURCE]: 4_096,
      [BRUSH]: 128,
    })
  })
})
