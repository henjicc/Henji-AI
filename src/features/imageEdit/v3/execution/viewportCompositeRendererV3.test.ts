import { describe, expect, it, vi } from 'vitest'

import {
  createFloat32PremultipliedRgbaTile,
  createImageEditAdjustmentLayerV3,
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditSparseMaskReferenceV3,
  decodeSrgbExtended,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportCompositeRenderRequestV3 } from './viewportCompositeProtocolV3'
import { renderImageEditorViewportCompositeV3 } from './viewportCompositeRendererV3'
import { planImageEditorViewportTilesV3 } from './viewportTilePlannerV3'

const RESOURCE = `sha256:${'a'.repeat(64)}` as const

function sourceTile(value: number): ImageEditorV3SourceTile {
  const pixels = new Uint8Array(4 * 4 * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set([value, value, value, 255], offset)
  }
  return {
    resourceRef: RESOURCE,
    mip: 0,
    tileX: 0,
    tileY: 0,
    halo: 0,
    width: 4,
    height: 4,
    channels: 4,
    bitDepth: 8,
    sampleFormat: 'uint',
    numericRange: 'unorm8',
    byteOrder: 'little-endian',
    rowStride: 16,
    colorSpace: 'srgb',
    transferFunction: 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    originX: 0,
    originY: 0,
    pixels: pixels.buffer,
  }
}

function request(
  document: ReturnType<typeof createImageEditDocumentV3>,
  tile: ImageEditorV3SourceTile,
): ImageEditorViewportCompositeRenderRequestV3 {
  return {
    type: 'render',
    requestId: 'renderer-test',
    sequence: 1,
    document,
    quality: 'stable',
    plan: planImageEditorViewportTilesV3({
      resourceRef: RESOURCE,
      documentSize: document.geometry,
      pyramid: {
        tileSize: 512,
        levels: [{ mip: 0, width: 4, height: 4, columns: 1, rows: 1 }],
      },
      viewport: { documentX: 0, documentY: 0, width: 4, height: 4, zoom: 1, devicePixelRatio: 1 },
      bitDepth: 8,
    }),
    sourceTiles: [tile],
    brushTiles: [],
  }
}

describe('图片编辑 V3 视口成品分块执行器', () => {
  it('在小区域内执行调整图层，而不是把原始 source tile 直接发布', async () => {
    const document = createImageEditDocumentV3({
      width: 4,
      height: 4,
      documentId: 'viewport-effect',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    document.layers.push(createImageEditAdjustmentLayerV3(
      'exposure',
      '曝光',
      'exposure',
      { stops: 1, offset: 0, gamma: 1 },
    ))
    const output: number[] = []

    await renderImageEditorViewportCompositeV3(
      request(document, sourceTile(64)),
      new AbortController().signal,
      ({ tile }) => { output.push(tile.data[0]) },
    )

    expect(output).toHaveLength(1)
    expect(output[0]).toBeGreaterThan(decodeSrgbExtended(64 / 255))
  })

  it('按全局文档坐标光栅化标注并参与图层混合', async () => {
    const document = createImageEditDocumentV3({
      width: 4,
      height: 4,
      documentId: 'viewport-annotation',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    document.layers.push(createImageEditAnnotationLayerV3('annotation', '标注'))
    const rasterizeAnnotations = vi.fn((_node, _document, region, mip) => {
      const data = new Float32Array(region.width * region.height * 4)
      for (let offset = 0; offset < data.length; offset += 4) data.set([0.5, 0, 0, 0.5], offset)
      expect(mip).toBe(0)
      return createFloat32PremultipliedRgbaTile(region.width, region.height, 'linear-light', data)
    })
    let rendered = 0

    await renderImageEditorViewportCompositeV3(
      request(document, sourceTile(0)),
      new AbortController().signal,
      ({ tile, outputRect }) => {
        rendered += 1
        expect(outputRect).toEqual({ x: 0, y: 0, width: 4, height: 4 })
        expect(tile.data[0]).toBeCloseTo(0.5, 5)
        expect(tile.data[3]).toBeCloseTo(1, 5)
      },
      { rasterizeAnnotations },
    )

    expect(rendered).toBe(1)
    expect(rasterizeAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({ definitionId: 'vector.annotation' }),
      document,
      { x: 0, y: 0, width: 4, height: 4 },
      0,
      expect.any(AbortSignal),
    )
  })

  it('按当前区域读取稀疏 Float32 蒙版并参与最终合成', async () => {
    const document = createImageEditDocumentV3({
      width: 4,
      height: 4,
      documentId: 'viewport-mask',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    const mask = createImageEditSparseMaskReferenceV3('mask', false, 1)
    const maskResource = `sha256:${'b'.repeat(64)}`
    mask.tiles['0/0/0'] = maskResource
    document.layers[0].mask = mask
    const renderRequest = request(document, sourceTile(255))
    renderRequest.brushTiles = [{
      resourceId: maskResource,
      storage: 'mask-float32',
      width: 4,
      height: 4,
      bytes: Float32Array.from({ length: 16 }, () => 0.25).buffer,
    }]
    let resultAlpha = 0

    await renderImageEditorViewportCompositeV3(
      renderRequest,
      new AbortController().signal,
      ({ tile }) => { resultAlpha = tile.data[3] },
    )

    expect(resultAlpha).toBeCloseTo(0.25, 5)
  })
})
