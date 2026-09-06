import { describe, expect, it } from 'vitest'
import {
  createImageEditAnnotationLayerV3, createImageEditDocumentV3, createImageEditGroupLayerV3,
  createImageEditRasterLayerV3, createTileRegion,
  ImageEditRenderScheduler, ImageEditResourceBudget, mipSize,
  type ImageEditDocumentV3,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3PyramidDescriptor, ImageEditorV3ResourceRef, ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorViewportTileSchedulerV3 } from './viewportTileSchedulerV3'
import { ImageEditorViewportCompositeClientV3 } from './viewportCompositeClientV3'
import { ImageEditorPreviewBrushTileLoaderV3 } from './previewBrushTileLoaderV3'
import { IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE } from '../application/imageEditorResourceDescriptorsV3'
import {
  renderImageEditorViewportCompositeV3,
  type ImageEditorViewportCompositeRendererDependenciesV3,
  type ImageEditorViewportRenderedRegionV3,
} from './viewportCompositeRendererV3'
import type { ImageEditorViewportCompositeWorkerRequestV3 } from './viewportCompositeProtocolV3'
import { bitmap, emitCompletedFrame, FakeViewportWorker, RENDER_IDENTITY } from './viewportCompositeClientV3.testSupport'

const SOURCE = `sha256:${'1'.repeat(64)}` as const
const SECOND = `sha256:${'2'.repeat(64)}` as const
const THIRD = `sha256:${'3'.repeat(64)}` as const
interface Source { width: number; height: number; rgba: readonly number[] }

function pyramid(source: Source): ImageEditorV3PyramidDescriptor {
  const levels: ImageEditorV3PyramidDescriptor['levels'] = []
  for (let mip = 0; mip <= 30; mip += 1) {
    const size = mipSize(source, mip)
    levels.push({ mip, ...size, columns: Math.ceil(size.width / 512), rows: Math.ceil(size.height / 512) })
    if (size.width === 1 && size.height === 1) break
  }
  return { tileSize: 512, levels }
}

/** 只替换存储读取及 Worker 传输，保留客户端、调度器、资源依赖规划与 CPU 像素执行。 */
async function render(
  document: ImageEditDocumentV3,
  sources: ReadonlyMap<ImageEditorV3ResourceRef, Source>,
  options: {
    minimumMip?: number
    descriptors?: Array<{ resourceRef: ImageEditorV3ResourceRef; byteLength: number; mediaType: string }>
    brushLoader?: ImageEditorPreviewBrushTileLoaderV3
    rasterizeAnnotations?: ImageEditorViewportCompositeRendererDependenciesV3['rasterizeAnnotations']
  } = {},
): Promise<{
  reads: Array<{ resourceRef: string; mip: number; tileX: number }>
  describes: number
  request: Extract<ImageEditorViewportCompositeWorkerRequestV3, { type: 'render' }>
  pixel(x: number, y: number): number[]
}> {
  const reads: Array<{ resourceRef: string; mip: number; tileX: number }> = []
  let describes = 0
  const source = (ref: ImageEditorV3ResourceRef): Source => {
    const found = sources.get(ref)
    if (!found) throw new Error('测试源不存在')
    return found
  }
  const scheduler = new ImageEditorViewportTileSchedulerV3({
    sessionId: 'heterogeneous-source-integration',
    describePyramid: async ({ resourceRef }) => { describes += 1; return pyramid(source(resourceRef)) },
    readSourceTile: async (request): Promise<ImageEditorV3SourceTile> => {
      const original = source(request.resourceRef)
      expect(pyramid(original).levels.some(({ mip }) => mip === request.mip)).toBe(true)
      const region = createTileRegion(original, { mip: request.mip, x: request.tileX, y: request.tileY }, request.halo)
      const { width, height, x: originX, y: originY } = region.sourceRect
      const pixels = new Uint8Array(width * height * 4)
      for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(original.rgba, offset)
      reads.push(request)
      return { ...request, width, height, originX, originY, channels: 4, bitDepth: 8,
        sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian', rowStride: width * 4,
        colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true, pixels: pixels.buffer }
    },
  })
  const regions: ImageEditorViewportRenderedRegionV3[] = []
  class CpuWorker extends FakeViewportWorker {
    override postMessage(message: ImageEditorViewportCompositeWorkerRequestV3): void {
      super.postMessage(message)
      if (message.type !== 'render') return
      void renderImageEditorViewportCompositeV3(message, new AbortController().signal,
        (region) => { regions.push(region) }, {
          ...(options.rasterizeAnnotations ? { rasterizeAnnotations: options.rasterizeAnnotations } : {}),
        }).then(() => {
        emitCompletedFrame(this, message, { revision: document.revision, mip: message.plan.mip, width: 64, height: 64 },
          regions.map(({ outputRect }) => ({ outputRect, bitmap: bitmap(outputRect.width, outputRect.height) })))
      }).catch((error: unknown) => {
        this.emit({ type: 'failed', requestId: message.requestId, sequence: message.sequence,
          renderGeneration: message.renderGeneration, code: 'render-failed', message: String(error) })
      })
    }
  }
  const worker = new CpuWorker()
  const budget = new ImageEditResourceBudget()
  const client = new ImageEditorViewportCompositeClientV3({ sessionId: 'source-geometry-client', scheduler,
    workerFactory: () => worker, resourceBudget: budget, renderScheduler: new ImageEditRenderScheduler(),
    ...(options.brushLoader ? { brushTileLoader: options.brushLoader } : {}) })
  try {
    const result = await client.render({ document, ...RENDER_IDENTITY, quality: 'stable',
      resourceDescriptors: options.descriptors ?? [], minimumMip: options.minimumMip,
      viewportKey: 'source-geometry', coverage: 'document', overscanViewports: 0,
      viewport: { documentX: 0, documentY: 0, width: 64, height: 64, zoom: 1, devicePixelRatio: 1 } })
    result.release()
    expect(regions).toHaveLength(1)
    const request = worker.messages.find((message) => message.type === 'render')
    if (!request || request.type !== 'render') throw new Error('缺少正式 Worker 请求')
    const outputSize = mipSize(document.geometry, request.plan.mip)
    expect(regions[0].outputRect).toEqual({ x: 0, y: 0, ...outputSize })
    expect(request.resourceSizes).toEqual([...sources].map(([resourceRef, size]) => ({
      resourceRef, width: size.width, height: size.height,
    })))
    return { reads, describes, request,
      pixel: (x: number, y: number): number[] => Array.from(regions[0].tile.data.slice(
        (y * regions[0].tile.width + x) * 4,
        (y * regions[0].tile.width + x) * 4 + 4,
      )) }
  } finally {
    client.dispose()
    expect(budget.snapshot().totalBytes).toBe(0)
  }
}

describe('CPU 视口异尺寸源的完整外层入口', () => {
  it.each([
    { name: '缺少 mip0', descriptor: { tileSize: 512 as const, levels: [{ mip: 1, width: 8, height: 8, columns: 1, rows: 1 }] }, error: '缺少 mip 0' },
    { name: '非法 mip 几何', descriptor: { tileSize: 512 as const, levels: [
      { mip: 0, width: 16, height: 16, columns: 1, rows: 1 },
      { mip: 1, width: 7, height: 8, columns: 1, rows: 1 },
    ] }, error: '尺寸不一致' },
  ])('$name 仍拒绝且不发起源瓦片读取', async ({ descriptor, error }) => {
    let reads = 0
    const scheduler = new ImageEditorViewportTileSchedulerV3({ sessionId: 'invalid-source-descriptor',
      describePyramid: async () => descriptor,
      readSourceTile: async () => { reads += 1; throw new Error('不得读取') } })
    try {
      await expect(scheduler.render({ resourceRef: SOURCE, revision: 0,
        documentSize: { width: 64, height: 64 }, bitDepth: 8,
        viewport: { documentX: 0, documentY: 0, width: 64, height: 64, zoom: 1, devicePixelRatio: 1 },
      })).rejects.toThrow(error)
      expect(reads).toBe(0)
    } finally { scheduler.dispose() }
  })

  it('全隐藏与空组通过正式客户端输出透明像素且 0 源读取', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: SOURCE })
    document.layers[0].visible = false
    document.layers.push(createImageEditGroupLayerV3('empty', '空组'))
    const result = await render(document, new Map())
    expect(result.describes).toBe(0)
    expect(result.reads).toEqual([])
    expect(result.request.resourceSizes).toEqual([])
    expect(result.request.sourceMipLevels).toEqual([])
    expect(result.pixel(0, 0)).toEqual([0, 0, 0, 0])
  })

  it('无图片源的标注仍执行区域 RenderPlan，不被透明快路吞掉', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64 })
    document.layers = [createImageEditAnnotationLayerV3('annotation', '标注')]
    const result = await render(document, new Map(), {
      rasterizeAnnotations: (_node, _document, region) => {
        const data = new Float32Array(region.width * region.height * 4)
        data.set([0.5, 0, 0, 0.5])
        return { width: region.width, height: region.height, storage: 'rgba-float32', alpha: 'premultiplied', colorDomain: 'linear-light',
          workingSpace: 'srgb', transferFunction: 'srgb', referenceWhiteNits: 203, data }
      },
    })
    expect(result.describes).toBe(0)
    expect(result.reads).toEqual([])
    expect(result.pixel(0, 0)[0]).toBeGreaterThan(0)
  })

  it('无底图的稀疏画笔仍从正式客户端进入 Worker 并输出非透明像素', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64 })
    const raster = createImageEditRasterLayerV3('paint', '绘画')
    const brush = `sha256:${'4'.repeat(64)}` as const
    raster.tiles = { '0/0/0': brush }
    document.layers = [raster]
    const data = new Float32Array(64 * 64 * 4)
    for (let offset = 0; offset < data.length; offset += 4) data.set([0, 0.5, 0, 0.5], offset)
    const brushLoader = new ImageEditorPreviewBrushTileLoaderV3({
      reader: async ({ tiles }) => ({ tiles: tiles.map(({ tileKey }) => ({
        tileKey,
        tile: { width: 64, height: 64, storage: 'rgba-float32', colorDomain: 'linear-light', workingSpace: 'srgb',
          transferFunction: 'srgb', referenceWhiteNits: 203, alpha: 'premultiplied', data: data.slice() },
      })) }),
    })
    const result = await render(document, new Map(), {
      descriptors: [{ resourceRef: brush, byteLength: data.byteLength,
        mediaType: IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE }],
      brushLoader,
    })
    expect(result.describes).toBe(0)
    expect(result.reads).toEqual([])
    expect(result.pixel(0, 0)[1]).toBeGreaterThan(0)
    expect(result.pixel(0, 0)[3]).toBeCloseTo(0.5, 5)
  })

  it('小图源经明确缩放铺满画布时，更粗输出 mip 仍按真实末级读取并保留像素', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: SOURCE })
    document.layers[0].transform = [64, 0, 0, 64, 0, 0]
    const result = await render(
      document,
      new Map([[SOURCE, { width: 1, height: 1, rgba: [255, 0, 0, 255] }]]),
      { minimumMip: 3 },
    )
    expect(result.request.plan).toMatchObject({ mip: 3, mipSize: { width: 8, height: 8 } })
    expect(result.request.sourceMipLevels).toEqual([{ resourceRef: SOURCE, mip: 0 }])
    expect(result.reads).toEqual([expect.objectContaining({ resourceRef: SOURCE, mip: 0, tileX: 0 })])
    const center = result.pixel(4, 4)
    expect(center[0]).toBeCloseTo(center[3], 5)
    expect(center[0]).toBeGreaterThan(0.8)
    expect(result.pixel(0, 0)[0]).toBeGreaterThan(0)
    expect(result.pixel(7, 7)[0]).toBeGreaterThan(0)
  })

  it('奇数小图源在输出 mip 超过末级时仍按二次幂坐标缩放，不按 ceil 尺寸拉满', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: SOURCE })
    const result = await render(
      document,
      new Map([[SOURCE, { width: 3, height: 5, rgba: [255, 0, 0, 255] }]]),
      { minimumMip: 4 },
    )
    expect(result.request.plan).toMatchObject({ mip: 4, mipSize: { width: 4, height: 4 } })
    expect(result.request.sourceMipLevels).toEqual([{ resourceRef: SOURCE, mip: 3 }])
    expect(result.pixel(0, 0)[3]).toBeGreaterThan(0)
    expect(result.pixel(0, 0)[3]).toBeLessThan(1)
    expect(result.pixel(1, 0)).toEqual([0, 0, 0, 0])
  })

  it('16×16 首源放入 64×64 文档，源外透明且没有将源 metadata 改成文档尺寸', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: SOURCE })
    const result = await render(document, new Map([[SOURCE, { width: 16, height: 16, rgba: [255, 0, 0, 255] }]]))
    expect(result.pixel(8, 8)).toEqual([1, 0, 0, 1])
    expect(result.pixel(32, 32)).toEqual([0, 0, 0, 0])
    expect(result.reads).toHaveLength(1)
  })

  it('640×640 首源缩小 0.1 后覆盖 64×64 输出，完整读取后半源瓦片', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: SOURCE })
    document.layers[0].transform = [0.1, 0, 0, 0.1, 0, 0]
    const result = await render(document, new Map([[SOURCE, { width: 640, height: 640, rgba: [0, 255, 0, 255] }]]))
    expect(result.pixel(32, 32)).toEqual([0, 1, 0, 1])
    expect(result.pixel(60, 60)).toEqual([0, 1, 0, 1])
    expect(result.reads.some(({ tileX }) => tileX === 1)).toBe(true)
  })

  it('首源及其他层全都异于文档时保留各自源边界、缩放和平移后的真实像素', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: SOURCE })
    const second = createImageEditRasterLayerV3('second', '第二层', SECOND)
    second.transform = [0.05, 0, 0, 0.05, 32, 0]
    const third = createImageEditRasterLayerV3('third', '第三层', THIRD)
    third.transform = [1, 0, 0, 1, 0, 32]
    document.layers.push(second, third)
    const result = await render(document, new Map<ImageEditorV3ResourceRef, Source>([
      [SOURCE, { width: 16, height: 16, rgba: [255, 0, 0, 255] }],
      [SECOND, { width: 640, height: 640, rgba: [0, 255, 0, 255] }],
      [THIRD, { width: 7, height: 23, rgba: [0, 0, 255, 255] }],
    ]))
    expect(result.pixel(8, 8)).toEqual([1, 0, 0, 1])
    expect(result.pixel(48, 16)).toEqual([0, 1, 0, 1])
    expect(result.pixel(3, 40)).toEqual([0, 0, 1, 1])
    expect(result.pixel(20, 40)).toEqual([0, 0, 0, 0])
  })
})
