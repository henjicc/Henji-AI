import { describe, expect, it, vi } from 'vitest'
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../documentFactory'
import { createFloat32MaskTile, createFloat32PremultipliedRgbaTile } from '../effects/contracts'
import type { ImageEditRect } from '../tileGeometry'
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler'
import { resampleImageEditMaskAffineV3, resampleImageEditRgbaAffineV3 } from './affineTransform'
import { collectImageEditCpuRegionRequirementsV3, executeImageEditCpuRenderRegionPlanV3 } from './cpuRenderRegionExecutor'
import { resolveImageEditCpuSamplingGridV3, type ImageEditCpuSamplingTargetV3 } from './cpuSamplingGrid'

const registry = createBuiltInImageEditRenderNodeRegistry()
const outputRegion = { x: 0, y: 0, width: 8, height: 8 }
const sourceRect = { x: 0, y: 0, width: 1, height: 1 }
const sourceToOutput = [8, 0, 0, 8, 0, 0] as const

function rgba(region: ImageEditRect, pixel: (x: number, y: number) => readonly number[]) {
  const data = new Float32Array(region.width * region.height * 4)
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    data.set(pixel(x + region.x, y + region.y), (y * region.width + x) * 4)
  }
  return createFloat32PremultipliedRgbaTile(region.width, region.height, 'linear-light', data)
}

function fixture(painted = false) {
  const document = createImageEditDocumentV3({ width: 1024, height: 1024 })
  const layer = createImageEditRasterLayerV3('source', '1像素放大', 'sha256:shared')
  layer.transform = [64, 0, 0, 64, 0, 0]
  if (painted) layer.tiles = { '0/1/0': 'sha256:transparent-outside' }
  document.layers = [layer]
  return { document, layer }
}

describe('CPU 区域合成的唯一采样网格契约', () => {
  it.each([false, true])('1px放大64倍在输出mip3保留源像素，远处透明稀疏覆盖=%s', async (painted) => {
    const { document } = fixture(painted)
    const plan = compileImageEditRenderPlanV3(document, registry, 'stable')
    const context = {
      size: { width: 128, height: 128 }, scaleX: 1 / 8, scaleY: 1 / 8, registry,
      resolveSamplingGrid: (target: ImageEditCpuSamplingTargetV3) => target.kind === 'content' && target.node.definitionId === 'source.raster'
        ? { size: painted ? { width: 1024, height: 512 } : sourceRect, toEvaluation: [1 / 8, 0, 0, 1 / 8, 0, 0] as const }
        : undefined,
      createTransparent: (region: ImageEditRect) => rgba(region, () => [0, 0, 0, 0]),
      // 稀疏存储改变载入网格范围但不改变底图采样语义；未命中远处覆盖的ROI保留底图。
      loadRaster: vi.fn(async (_node, region: ImageEditRect) => rgba(region, (x, y) => x === 0 && y === 0 ? [1, 0, 0, 1] : [0, 0, 0, 0])),
      rasterizeAnnotations: async () => { throw new Error('没有标注') },
      loadMask: async () => { throw new Error('没有蒙版') },
    }
    const expected = resampleImageEditRgbaAffineV3(rgba(sourceRect, () => [1, 0, 0, 1]), sourceRect, outputRegion, sourceToOutput)
    const actual = await executeImageEditCpuRenderRegionPlanV3(plan, outputRegion, context)
    expect(Array.from(actual!.data)).toEqual(Array.from(expected.data))
    expect(actual!.data[(4 * 8 + 4) * 4 + 3]).toBeGreaterThan(.8)
    const requirements = collectImageEditCpuRegionRequirementsV3(plan, [outputRegion], context)
    const sourceNode = plan.nodes.find((node) => node.definitionId === 'source.raster')!
    expect(context.loadRaster.mock.calls[0][1]).toEqual(requirements.rasterRegions.get(sourceNode.id)![0])
    expect(document.layers[0].transform).toEqual([64, 0, 0, 64, 0, 0])
  })

  it('同源普通层与画笔层按各自实际网格求值，不按resourceRef串用范围', async () => {
    const { document, layer } = fixture(false)
    const painted = createImageEditRasterLayerV3('painted', '画笔层', 'sha256:shared')
    painted.transform = [...layer.transform]
    painted.tiles = { '0/1/0': 'sha256:transparent-outside' }
    painted.opacity = .5
    document.layers.push(painted)
    const actual = await executeImageEditCpuRenderRegionPlanV3(compileImageEditRenderPlanV3(document, registry, 'stable'), outputRegion, {
      size: { width: 128, height: 128 }, scaleX: 1 / 8, scaleY: 1 / 8, registry,
      resolveSamplingGrid: (target) => target.kind === 'content' && target.node.definitionId === 'source.raster'
        ? { size: target.node.layerId === 'painted' ? { width: 1024, height: 512 } : sourceRect,
          toEvaluation: [1 / 8, 0, 0, 1 / 8, 0, 0] } : undefined,
      createTransparent: (region) => rgba(region, () => [0, 0, 0, 0]),
      loadRaster: async (_node, region) => rgba(region, (x, y) => x === 0 && y === 0 ? [1, 0, 0, 1] : [0, 0, 0, 0]),
      rasterizeAnnotations: async () => { throw new Error('没有标注') }, loadMask: async () => { throw new Error('没有蒙版') },
    })
    const alpha = resampleImageEditRgbaAffineV3(rgba(sourceRect, () => [1, 0, 0, 1]), sourceRect, outputRegion, sourceToOutput).data
    for (let index = 3; index < alpha.length; index += 4) {
      expect(actual!.data[index]).toBeCloseTo(alpha[index] + .5 * alpha[index] * (1 - alpha[index]), 6)
    }
  })

  it.each([0, 2, 3])('半透明大蒙版使用自己的mip%s，不共用1px内容ROI或缩放', async (maskMip) => {
    const { document, layer } = fixture()
    layer.mask = { resourceId: 'sha256:mask', inverted: false }
    const maskEdge = 64 / (2 ** maskMip)
    const maskRect = { x: 0, y: 0, width: maskEdge, height: maskEdge }
    const loadMask = vi.fn(async (_ref, _node, region: ImageEditRect) => createFloat32MaskTile(
      region.width, region.height, new Float32Array(region.width * region.height).fill(.5),
    ))
    const context = {
      size: { width: 128, height: 128 }, scaleX: 1 / 8, scaleY: 1 / 8, registry,
      resolveSamplingGrid: (target: ImageEditCpuSamplingTargetV3) => target.kind === 'mask'
        ? { size: maskRect, toEvaluation: [2 ** (maskMip - 3), 0, 0, 2 ** (maskMip - 3), 0, 0] as const }
        : target.node.definitionId === 'source.raster'
          ? { size: sourceRect, toEvaluation: [1 / 8, 0, 0, 1 / 8, 0, 0] as const } : undefined,
      createTransparent: (region: ImageEditRect) => rgba(region, () => [0, 0, 0, 0]),
      loadRaster: async (_node: unknown, region: ImageEditRect) => rgba(region, () => [1, 0, 0, 1]),
      rasterizeAnnotations: async () => { throw new Error('没有标注') }, loadMask,
    }
    const plan = compileImageEditRenderPlanV3(document, registry, 'stable')
    const actual = await executeImageEditCpuRenderRegionPlanV3(plan, outputRegion, context)
    const reference = resampleImageEditRgbaAffineV3(rgba(sourceRect, () => [1, 0, 0, 1]), sourceRect, outputRegion, sourceToOutput)
    const maskScale = 64 * 2 ** (maskMip - 3)
    const expectedMask = resampleImageEditMaskAffineV3(createFloat32MaskTile(maskEdge, maskEdge,
      new Float32Array(maskEdge * maskEdge).fill(.5)), maskRect, outputRegion, [maskScale, 0, 0, maskScale, 0, 0])
    for (let index = 0; index < expectedMask.data.length; index++) {
      expect(actual!.data[index * 4 + 3]).toBeCloseTo(reference.data[index * 4 + 3] * expectedMask.data[index], 6)
    }
    const requirements = collectImageEditCpuRegionRequirementsV3(plan, [outputRegion], context)
    const masked = plan.nodes.find((node) => node.mask)!
    expect(loadMask.mock.calls[0][2]).toEqual(requirements.maskRegions.get(masked.id)![0])
  })

  it.each([
    { name: '完全越界', region: { x: 2, y: 0, width: 2, height: 1 }, expected: [1, 1], reads: 0 },
    { name: '部分相交', region: { x: 0, y: 0, width: 4, height: 1 }, expected: [0, 1, 1, 1], reads: 1 },
  ])('反转蒙版$name的资源外像素保留可见内容', async ({ region, expected, reads }) => {
    const document = createImageEditDocumentV3({ width: 4, height: 1 })
    const layer = createImageEditRasterLayerV3('source', '不透明底图', 'sha256:source')
    layer.mask = { resourceId: 'sha256:small-mask', inverted: true }
    document.layers = [layer]
    const loadMask = vi.fn(async (_reference: unknown, _node: unknown, requested: ImageEditRect) => (
      createFloat32MaskTile(requested.width, requested.height,
        new Float32Array(requested.width * requested.height).fill(1))
    ))
    const actual = await executeImageEditCpuRenderRegionPlanV3(
      compileImageEditRenderPlanV3(document, registry, 'stable'), region, {
        size: { width: 4, height: 1 }, registry,
        resolveSamplingGrid: (target) => target.kind === 'mask'
          ? { size: { width: 1, height: 1 }, toEvaluation: [1, 0, 0, 1, 0, 0] } : undefined,
        createTransparent: (requested) => rgba(requested, () => [0, 0, 0, 0]),
        loadRaster: async (_node, requested) => rgba(requested, () => [1, 1, 1, 1]),
        rasterizeAnnotations: async () => { throw new Error('没有标注') }, loadMask,
      },
    )
    expect(Array.from(actual!.data).filter((_value, index) => index % 4 === 3)).toEqual(expected)
    expect(loadMask).toHaveBeenCalledTimes(reads)
  })

  it('无效实际网格在发起像素读取前拒绝', () => {
    const { document } = fixture()
    const plan = compileImageEditRenderPlanV3(document, registry, 'stable')
    const target = { kind: 'content' as const, node: plan.nodes[0] }
    expect(() => resolveImageEditCpuSamplingGridV3({ size: { width: 8, height: 8 },
      resolveSamplingGrid: () => ({ size: { width: 0, height: 1 }, toEvaluation: [1, 0, 0, 1, 0, 0] }),
    }, target)).toThrow('有效尺寸')
    expect(() => collectImageEditCpuRegionRequirementsV3(plan, [outputRegion], {
      size: { width: 8, height: 8 }, registry,
      resolveSamplingGrid: () => ({ size: { width: 1, height: 1 }, toEvaluation: [0, 0, 0, 0, 0, 0] }),
    })).toThrow('可逆坐标映射')
  })
})
