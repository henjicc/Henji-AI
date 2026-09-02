import { describe, expect, it, vi } from 'vitest'

import {
  createFloat32PremultipliedRgbaTile,
  createImageEditAdjustmentLayerV3,
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditSparseMaskReferenceV3,
  decodeSrgbExtended,
  imageEditOutputSizeV3,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportCompositeRenderRequestV3 } from './viewportCompositeProtocolV3'
import { renderImageEditorViewportCompositeV3 } from './viewportCompositeRendererV3'
import { ImageEditorViewportGlobalAnalysisCacheV3 } from './viewportGlobalAnalysisV3'
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

function wideSourceTile(tileX: number, value: number): ImageEditorV3SourceTile {
  const pixels = new Uint8Array(512 * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set([value, value, value, 255], offset)
  }
  return {
    ...sourceTile(value),
    tileX,
    width: 512,
    height: 1,
    rowStride: 512 * 4,
    originX: tileX * 512,
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
    renderGeneration: 1,
    cameraSequence: 1,
    geometryHash: 'geometry-test',
    document,
    quality: 'stable',
    plan: planImageEditorViewportTilesV3({
      resourceRef: RESOURCE,
      documentSize: imageEditOutputSizeV3(document.geometry),
      sourceSize: document.geometry,
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
    document.layers[0].transform = [1, 0, 0, 1, 1, 0]
    const renderRequest = request(document, sourceTile(255))
    renderRequest.brushTiles = [{
      resourceId: maskResource,
      storage: 'mask-float32',
      width: 4,
      height: 4,
      bytes: Float32Array.from({ length: 16 }, () => 0.25).buffer,
    }]
    let resultAlpha: number[] = []

    await renderImageEditorViewportCompositeV3(
      renderRequest,
      new AbortController().signal,
      ({ tile }) => {
        resultAlpha = Array.from({ length: 4 }, (_, x) => tile.data[x * 4 + 3])
      },
    )

    expect(resultAlpha[0]).toBe(0)
    expect(resultAlpha.slice(1)).toEqual([0.25, 0.25, 0.25])
  })

  it('输出 tile 与源 tile 坐标不同时，按逆变换拼接真正需要的源区域', async () => {
    const document = createImageEditDocumentV3({
      width: 1_024,
      height: 1,
      documentId: 'viewport-inverse-source',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    document.layers[0].transform = [1, 0, 0, 1, 512, 0]
    const renderRequest: ImageEditorViewportCompositeRenderRequestV3 = {
      type: 'render',
      requestId: 'inverse-source',
      sequence: 1,
      renderGeneration: 1,
      cameraSequence: 1,
      geometryHash: 'geometry-test',
      document,
      quality: 'stable',
      plan: planImageEditorViewportTilesV3({
        resourceRef: RESOURCE,
        documentSize: document.geometry,
        pyramid: {
          tileSize: 512,
          levels: [{ mip: 0, width: 1_024, height: 1, columns: 2, rows: 1 }],
        },
        viewport: {
          documentX: 512, documentY: 0, width: 512, height: 1,
          zoom: 1, devicePixelRatio: 1,
        },
        bitDepth: 8,
      }),
      sourceTiles: [wideSourceTile(0, 96)],
      brushTiles: [],
    }
    let first = 0
    await renderImageEditorViewportCompositeV3(
      renderRequest,
      new AbortController().signal,
      ({ outputRect, tile }) => {
        expect(outputRect.x).toBe(512)
        first = tile.data[0]
      },
    )
    expect(first).toBeCloseTo(decodeSrgbExtended(96 / 255), 5)
  })

  it('裁剪与方向在输出边界原子投影，不先发布未裁剪整图', async () => {
    const document = createImageEditDocumentV3({
      width: 4,
      height: 4,
      documentId: 'viewport-output-geometry',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    document.geometry.orientation = { rotate: 90, mirrored: false }
    document.geometry.crop = { x: 1, y: 1, width: 2, height: 2 }
    const pixels = new Uint8Array(4 * 4 * 4)
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        pixels.set([y * 4 + x, 0, 0, 255], (y * 4 + x) * 4)
      }
    }
    const tile = { ...sourceTile(0), pixels: pixels.buffer }
    let outputRect
    let red: number[] = []
    await renderImageEditorViewportCompositeV3(
      request(document, tile),
      new AbortController().signal,
      ({ outputRect: rect, tile: rendered }) => {
        outputRect = rect
        red = Array.from({ length: 4 }, (_, index) => rendered.data[index * 4])
      },
    )
    expect(outputRect).toEqual({ x: 0, y: 0, width: 2, height: 2 })
    const expected = [9, 5, 10, 6].map((value) => decodeSrgbExtended(value / 255))
    red.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 7))
  })

  it('分析阶段建立共享结果，目标视口缺失分析时拒绝回退到分块近似', async () => {
    const document = createImageEditDocumentV3({
      width: 4,
      height: 4,
      documentId: 'viewport-global-analysis',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    document.layers.push(createImageEditEffectLayerV3(
      'blur', '模糊', 'image.fast-blur-v3', { radius: 40, quality: 'high', mip: 0 },
    ))
    const globalAnalyses = new ImageEditorViewportGlobalAnalysisCacheV3()
    const analysisRequest = request(document, sourceTile(192))
    analysisRequest.phase = 'analysis'
    analysisRequest.analysisRequested = true
    await renderImageEditorViewportCompositeV3(
      analysisRequest,
      new AbortController().signal,
      () => undefined,
      { globalAnalyses },
    )

    const targetRequest = request(document, sourceTile(192))
    targetRequest.phase = 'target'
    let rendered = 0
    await renderImageEditorViewportCompositeV3(
      targetRequest,
      new AbortController().signal,
      () => { rendered += 1 },
      { globalAnalyses },
    )
    expect(rendered).toBe(1)

    globalAnalyses.dispose()
    await expect(renderImageEditorViewportCompositeV3(
      targetRequest,
      new AbortController().signal,
      () => undefined,
      { globalAnalyses },
    )).rejects.toThrow('缺少共享全局分析')
  })
})
