import { describe, expect, it, vi } from 'vitest'
import { ImageEditResourceBudget, createImageEditEffectLayerV3, imageEditOutputSizeV3,
  type ImageEditJsonObjectV3, type Float32PremultipliedRgbaTile } from '@/core/imageEdit/v3'
import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import { createDefaultVgpuGlowOperationParams } from '@/core/imageEdit/vgpuGlowParams'
import { BRUSH, SOURCE, createRasterSourceBrushFixtureV3 } from '../editor/rasterBrushSourceGeometryV3.testSupport'
import { renderImageEditorViewportCompositeV3 } from '../execution/viewportCompositeRendererV3'
import { planImageEditorViewportTilesV3 } from '../execution/viewportTilePlannerV3'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'
import { description } from './renderExportTestFixtures'
import { prepareImageEditorV3ExportRender } from './capabilities'
import { createImageEditorV3SparseRasterPlan } from './brushRegion'
import { buildImageEditorV3DiffusionAnalyses } from './diffusionAnalysis'
import { buildImageEditorV3FastBlurAnalyses } from './fastBlurAnalysis'
import { buildImageEditorV3VgpuGlowAnalyses } from './vgpuGlowAnalysis'
import type { ImageEditorV3ExportRenderDependencies, ImageEditorV3VgpuGlowRuntime } from './contracts'

async function fixture(source = 16, localX = 48, scale = 1) {
  const value = createRasterSourceBrushFixtureV3(source, 64, scale)
  value.stroke.begin()
  await value.stroke.append([{ x: localX, y: localX, screenX: localX * scale, screenY: localX * scale }])
  await value.stroke.finish()
  const document = value.bus.getSnapshot().document
  const descriptors = [{ resourceRef: BRUSH, byteLength: [...value.stored.values()][0].data.byteLength,
    mediaType: 'application/x-henji-brush-tile-v3' }]
  const dependencies: ImageEditorV3ExportRenderDependencies = {
    readSourcePyramid: value.readSourcePyramid,
    readSourceTile: (request) => value.readSourceTile({ mip: request.mip, x: request.tileX, y: request.tileY }),
    readBrushTiles: vi.fn(async (requests) => ({ tiles: requests.map(({ tileKey }) => ({ tileKey, tile: value.stored.get(tileKey)! })) })),
  }
  return { ...value, document, descriptors, dependencies }
}

describe('真实下笔的像素在所有 CPU 消费入口一致', () => {
  it.each([{ source: 16, localX: 48, scale: 1 }, { source: 640, localX: 505, scale: 0.1 }])(
    '$source原图真实下笔后，CPU视口和正式导出使用相同独立几何', async ({ source, localX, scale }) => {
      const value = await fixture(source, localX, scale)
      const size = imageEditOutputSizeV3(value.document.geometry)
      const sourceTiles = []
      for (let y = 0; y < Math.ceil(source / 512); y++) for (let x = 0; x < Math.ceil(source / 512); x++) {
        sourceTiles.push(await value.readSourceTile({ mip: 0, x, y }))
      }
      const output: Float32PremultipliedRgbaTile[] = []
      await renderImageEditorViewportCompositeV3({ type: 'render', requestId: 'stroke-viewport', sequence: 1,
        document: value.document, quality: 'stable', renderGeneration: 1, cameraSequence: 1, geometryHash: '64',
        plan: planImageEditorViewportTilesV3({ resourceRef: SOURCE, documentSize: size, sourceSize: size,
          pyramid: { tileSize: 512, levels: [{ mip: 0, ...size, columns: 1, rows: 1 }] },
          viewport: { documentX: 0, documentY: 0, ...size, zoom: 1, devicePixelRatio: 1 }, bitDepth: 8 }),
        resourceSizes: [{ resourceRef: SOURCE, width: source, height: source }], sourceTiles,
        brushTiles: [...value.stored.values()].map((tile) => ({ resourceId: BRUSH, storage: 'rgba-float32',
          width: tile.width, height: tile.height, bytes: tile.data.slice().buffer })),
      }, new AbortController().signal, ({ tile }) => { output.push(tile) })
      expect(output).toHaveLength(1)
      const pixel = Math.floor(localX * scale), offset = (pixel * 64 + pixel) * 4
      expect(output[0].data[offset]).toBeGreaterThan(0.5)
      const stream = renderImageEditorV3ExportTiles({ document: value.document,
        description: description(64, 64), resourceDescriptors: value.descriptors, tileSize: 64 }, value.dependencies)
      const iterator = stream[Symbol.asyncIterator]()
      try {
        const result = await iterator.next()
        if (result.done) throw new Error('缺少正式导出结果')
        const pixels = new Uint8Array(result.value.pixels)
        expect(pixels[offset]).toBeGreaterThan(128)
        expect(Math.abs(pixels[offset] / 255 - output[0].data[offset])).toBeLessThanOrEqual(1 / 255)
      } finally { await iterator.return?.() }
    })

  it.each([
    ['diffusion', 'image.diffusion', { ...createDefaultDiffusionOperationParams(), threshold: 0, strength: 1 }],
    ['blur', 'image.fast-blur-v3', { radius: 1000, mip: 0 }],
    ['glow', 'image.vgpu-glow', createDefaultVgpuGlowOperationParams()],
  ] as const)('%s正式全局分析读取原图外真实笔画像素，释放全部预算', async (kind, effect, params) => {
    const value = await fixture()
    value.document.layers.push(createImageEditEffectLayerV3('effect', '效果', effect, params as ImageEditJsonObjectV3))
    const { document, plan } = prepareImageEditorV3ExportRender(value.document, description(64, 64))
    const sparse = createImageEditorV3SparseRasterPlan(plan, document.geometry, value.descriptors,
      new Map([[SOURCE, { width: 16, height: 16 }]]))
    const budget = new ImageEditResourceBudget(), signal = new AbortController().signal
    const captured: Float32PremultipliedRgbaTile[] = []
    const runtime: ImageEditorV3VgpuGlowRuntime = { buildAnalysis: vi.fn(async ({ source }) => {
      captured.push(source); return { release: vi.fn() }
    }), render: async ({ source }) => source, dispose: vi.fn() }
    const dependencies = { ...value.dependencies, createVgpuGlowRuntime: () => runtime }
    const masks = { byMaskId: new Map() }
    if (kind === 'diffusion') {
      const set = await buildImageEditorV3DiffusionAnalyses(document, plan, signal, dependencies, budget, masks, sparse)
      try {
        expect(set.analyses.size).toBe(1)
        expect([...set.analyses.values()][0].scatter.data.some((v, i) => i % 4 === 0 && v > 0)).toBe(true)
      } finally { set.release() }
    } else if (kind === 'blur') {
      const set = await buildImageEditorV3FastBlurAnalyses(document, plan, signal, dependencies, budget, masks, sparse,
        new Map(), { analyses: new Map(), runtime, release: () => runtime.dispose() })
      try {
        expect(set.analyses.size).toBe(1)
        expect([...set.analyses.values()][0].tile.data.some((v, i) => i % 4 === 0 && v > 0)).toBe(true)
      } finally { set.release() }
    } else {
      const set = await buildImageEditorV3VgpuGlowAnalyses(document, plan, signal, dependencies, budget, masks, sparse, new Map())
      try { expect(captured[0].data[(48 * 64 + 48) * 4]).toBe(1) } finally { set.release() }
      expect(runtime.dispose).toHaveBeenCalledOnce()
    }
    expect(dependencies.readBrushTiles).toHaveBeenCalled()
    expect(budget.snapshot().leaseCount).toBe(0)
  })
})
