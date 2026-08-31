import { describe, expect, it } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
} from '@/core/imageEdit/v3'
import { IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE } from '../application/imageEditorResourceDescriptorsV3'
import {
  collectImageEditorViewportBrushRequestsV3,
  createImageEditorViewportSourceTileRequestsV3,
  ImageEditorViewportCompositeUnsupportedErrorV3,
  prepareImageEditorViewportCompositeV3,
} from './viewportCompositeDocumentV3'
import { planImageEditorViewportTilesV3 } from './viewportTilePlannerV3'

const SOURCE = `sha256:${'1'.repeat(64)}` as const
const BRUSH_LEFT = `sha256:${'2'.repeat(64)}` as const
const BRUSH_RIGHT = `sha256:${'3'.repeat(64)}` as const

describe('图片编辑 V3 视口合成能力边界', () => {
  it('全局分析效果与输出裁剪明确保留给全局受管预览', () => {
    const document = createImageEditDocumentV3({
      width: 512,
      height: 512,
      sourceResourceId: SOURCE,
      idFactory: () => 'source',
    })
    document.layers.push(createImageEditEffectLayerV3(
      'glow',
      '辉光',
      'image.vgpu-glow',
      { strength: 1 },
    ))
    expect(() => prepareImageEditorViewportCompositeV3(document, 'stable', []))
      .toThrow(ImageEditorViewportCompositeUnsupportedErrorV3)

    document.layers.pop()
    document.geometry.crop = { x: 0, y: 0, width: 256, height: 256 }
    expect(() => prepareImageEditorViewportCompositeV3(document, 'stable', []))
      .toThrow('全局受管预览')
  })

  it('只把当前含 halo 区域相交的稀疏画笔瓦片送入 Worker', () => {
    const document = createImageEditDocumentV3({
      width: 1_024,
      height: 512,
      documentId: 'brush-filter',
      sourceResourceId: SOURCE,
      idFactory: () => 'source',
    })
    const raster = document.layers[0]
    if (!raster || raster.type !== 'raster') throw new Error('测试缺少栅格图层')
    raster.tiles = { '0/0/0': BRUSH_LEFT, '0/1/0': BRUSH_RIGHT }
    const descriptors = [BRUSH_LEFT, BRUSH_RIGHT].map((resourceRef) => ({
      resourceRef,
      byteLength: 128,
      mediaType: IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE,
    }))
    const prepared = prepareImageEditorViewportCompositeV3(document, 'stable', descriptors)
    const plan = planImageEditorViewportTilesV3({
      resourceRef: SOURCE,
      documentSize: document.geometry,
      pyramid: {
        tileSize: 512,
        levels: [{ mip: 0, width: 1_024, height: 512, columns: 2, rows: 1 }],
      },
      viewport: { documentX: 0, documentY: 0, width: 512, height: 512, zoom: 1, devicePixelRatio: 1 },
      bitDepth: 8,
    })

    expect(collectImageEditorViewportBrushRequestsV3(prepared, plan)).toEqual([
      expect.objectContaining({ resourceId: BRUSH_LEFT, tileKey: '0/0/0' }),
    ])
  })

  it('平移图层按当前 mip 逆向请求真正的源瓦片', () => {
    const document = createImageEditDocumentV3({
      width: 1_024,
      height: 512,
      documentId: 'translated-source-requests',
      sourceResourceId: SOURCE,
      idFactory: () => 'source',
    })
    document.layers[0].transform = [1, 0, 0, 1, 512, 0]
    const prepared = prepareImageEditorViewportCompositeV3(document, 'stable', [])
    const plan = planImageEditorViewportTilesV3({
      resourceRef: SOURCE,
      documentSize: document.geometry,
      pyramid: {
        tileSize: 512,
        levels: [{ mip: 0, width: 1_024, height: 512, columns: 2, rows: 1 }],
      },
      viewport: {
        documentX: 512, documentY: 0, width: 512, height: 512,
        zoom: 1, devicePixelRatio: 1,
      },
      bitDepth: 8,
    })

    expect(createImageEditorViewportSourceTileRequestsV3(prepared, plan, 8))
      .toEqual([expect.objectContaining({ tileX: 0, tileY: 0, originX: 0 })])
  })
})
