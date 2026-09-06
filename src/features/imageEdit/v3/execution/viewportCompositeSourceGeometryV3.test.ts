import { describe, expect, it } from 'vitest'
import {
  createImageEditDocumentV3, createImageEditGroupLayerV3, createImageEditRasterLayerV3, createTileRegion,
  ImageEditRenderScheduler, ImageEditResourceBudget, mipSize,
  type ImageEditDocumentV3,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3PyramidDescriptor, ImageEditorV3ResourceRef, ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorViewportTileSchedulerV3 } from './viewportTileSchedulerV3'
import { ImageEditorViewportCompositeClientV3 } from './viewportCompositeClientV3'
import { ImageEditorViewportCompositeUnsupportedErrorV3, prepareImageEditorViewportCompositeV3 } from './viewportCompositeDocumentV3'
import { renderImageEditorViewportCompositeV3, type ImageEditorViewportRenderedRegionV3 } from './viewportCompositeRendererV3'
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
async function render(document: ImageEditDocumentV3, sources: ReadonlyMap<ImageEditorV3ResourceRef, Source>): Promise<{
  reads: Array<{ resourceRef: string; mip: number; tileX: number }>
  pixel(x: number, y: number): number[]
}> {
  const reads: Array<{ resourceRef: string; mip: number; tileX: number }> = []
  const source = (ref: ImageEditorV3ResourceRef): Source => {
    const found = sources.get(ref)
    if (!found) throw new Error('测试源不存在')
    return found
  }
  const scheduler = new ImageEditorViewportTileSchedulerV3({
    sessionId: 'heterogeneous-source-integration',
    describePyramid: async ({ resourceRef }) => pyramid(source(resourceRef)),
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
        (region) => { regions.push(region) }).then(() => {
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
    workerFactory: () => worker, resourceBudget: budget, renderScheduler: new ImageEditRenderScheduler() })
  try {
    const result = await client.render({ document, ...RENDER_IDENTITY, quality: 'stable', resourceDescriptors: [],
      viewportKey: 'source-geometry', coverage: 'document', overscanViewports: 0,
      viewport: { documentX: 0, documentY: 0, width: 64, height: 64, zoom: 1, devicePixelRatio: 1 } })
    result.release()
    expect(regions).toHaveLength(1)
    expect(regions[0].outputRect).toEqual({ x: 0, y: 0, width: 64, height: 64 })
    const request = worker.messages.find((message) => message.type === 'render')
    if (!request || request.type !== 'render') throw new Error('缺少正式 Worker 请求')
    expect(request.resourceSizes).toEqual([...sources].map(([resourceRef, size]) => ({
      resourceRef, width: size.width, height: size.height,
    })))
    return { reads, pixel: (x: number, y: number): number[] => Array.from(regions[0].tile.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)) }
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

  it('全隐藏与空组保留既有无图片资源 Unsupported 分类，不借隐藏图片伪造可见像素', () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: SOURCE })
    document.layers[0].visible = false
    document.layers.push(createImageEditGroupLayerV3('empty', '空组'))
    expect(() => prepareImageEditorViewportCompositeV3(document, 'stable', []))
      .toThrow(ImageEditorViewportCompositeUnsupportedErrorV3)
    expect(() => prepareImageEditorViewportCompositeV3(document, 'stable', []))
      .toThrow('当前文档没有可规划的图片金字塔资源')
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
