import { describe, expect, it } from 'vitest'
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../documentFactory'
import { createFloat32MaskTile, createFloat32PremultipliedRgbaTile } from '../effects/contracts'
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler'
import type { ImageEditRect } from '../tileGeometry'
import { executeImageEditCpuRenderPlanV3 } from './cpuRenderPlanExecutor'
import { executeImageEditCpuRenderRegionPlanV3 } from './cpuRenderRegionExecutor'
import { compositePremultipliedTilesV3 } from './tileBlend'
import { convertFloat32TileColorContractV3, encodeTransferFunctionV3 } from './tileColor'

const registry = createBuiltInImageEditRenderNodeRegistry()

function filled(region: ImageEditRect, rgba: readonly number[]) {
  const data = new Float32Array(region.width * region.height * 4)
  for (let index = 0; index < data.length; index += 4) data.set(rgba, index)
  return createFloat32PremultipliedRgbaTile(region.width, region.height, 'linear-light', data)
}

describe('CPU 图层合成完整契约', () => {
  it.each([
    { x: 1_536, y: 1_024, width: 512, height: 480 },
    { x: 2_048, y: 1_024, width: 512, height: 480 },
  ])('复现真实供应商底图2672×1504、恒等竹林层1631×1111在边缘的分块合成：%j', async (region) => {
    const document = createImageEditDocumentV3({ width: 2_672, height: 1_504 })
    document.layers = [
      createImageEditRasterLayerV3('base', '底图', 'sha256:base'),
      createImageEditRasterLayerV3('bamboo', '竹林', 'sha256:bamboo'),
    ]
    const result = await executeImageEditCpuRenderRegionPlanV3(
      compileImageEditRenderPlanV3(document, registry, 'stable'), region, {
        size: document.geometry,
        registry,
        resolveSourceSize: (node) => node.definitionId === 'source.raster' && node.layerId === 'bamboo'
          ? { width: 1_631, height: 1_111 } : document.geometry,
        createTransparent: (requested) => filled(requested, [0, 0, 0, 0]),
        loadRaster: async (node, requested) => {
          if (node.layerId === 'bamboo') {
            expect(requested.x + requested.width).toBeLessThanOrEqual(1_631)
            expect(requested.y + requested.height).toBeLessThanOrEqual(1_111)
          }
          return filled(requested, node.layerId === 'bamboo' ? [0, 1, 0, 1] : [0, 0, 1, 1])
        },
        rasterizeAnnotations: async () => { throw new Error('没有标注') },
        loadMask: async () => { throw new Error('没有蒙版') },
      },
    )
    expect(result).toMatchObject({ width: region.width, height: region.height })
    let mismatch = 0
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        const offset = (y * region.width + x) * 4
        const inside = region.x + x < 1_631 && region.y + y < 1_111
        if (result!.data[offset] !== 0 || result!.data[offset + 1] !== (inside ? 1 : 0)
          || result!.data[offset + 2] !== (inside ? 0 : 1) || result!.data[offset + 3] !== 1) mismatch += 1
      }
    }
    expect(mismatch).toBe(0)
  })

  it.each([false, true])('恒等变换的小图层按原坐标透明补齐，蒙版=%s', async (masked) => {
    const document = createImageEditDocumentV3({ width: 4, height: 3 })
    const layer = createImageEditRasterLayerV3('small', '分离元素', 'sha256:small')
    if (masked) layer.mask = { resourceId: 'sha256:mask', inverted: false }
    document.layers = [
      createImageEditRasterLayerV3('base', '底图', 'sha256:base'), layer,
    ]
    const plan = compileImageEditRenderPlanV3(document, registry, 'export')
    const result = await executeImageEditCpuRenderRegionPlanV3(
      plan, { x: 1, y: 1, width: 3, height: 2 }, {
        size: document.geometry,
        registry,
        resolveSourceSize: (node) => node.definitionId === 'source.raster' && node.layerId === 'small'
          ? { width: 2, height: 2 } : document.geometry,
        createTransparent: (region) => filled(region, [0, 0, 0, 0]),
        loadRaster: async (node, region) => filled(region, node.layerId === 'small'
          ? [1, 0, 0, 1] : [0, 0, 1, 1]),
        rasterizeAnnotations: async () => { throw new Error('没有标注') },
        loadMask: async (_mask, _node, region) => createFloat32MaskTile(
          region.width, region.height, new Float32Array(region.width * region.height).fill(0.5),
        ),
      },
    )
    expect(result).toMatchObject({ width: 3, height: 2 })
    expect([...result!.data.slice(0, 4)]).toEqual(masked ? [0.5, 0, 0.5, 1] : [1, 0, 0, 1])
    for (let pixel = 1; pixel < 6; pixel += 1) {
      expect([...result!.data.slice(pixel * 4, pixel * 4 + 4)]).toEqual([0, 0, 1, 1])
    }
  })

  it('只有一个小图层时也返回完整文档区域，区域外保持透明', async () => {
    const document = createImageEditDocumentV3({
      width: 4, height: 3, sourceResourceId: 'sha256:small',
    })
    const result = await executeImageEditCpuRenderRegionPlanV3(
      compileImageEditRenderPlanV3(document, registry, 'export'),
      { x: 0, y: 0, width: 4, height: 3 }, {
        size: document.geometry,
        registry,
        resolveSourceSize: (node) => node.definitionId === 'source.raster'
          ? { width: 2, height: 1 } : document.geometry,
        createTransparent: (region) => filled(region, [0, 0, 0, 0]),
        loadRaster: async (_node, region) => filled(region, [1, 0, 0, 1]),
        rasterizeAnnotations: async () => { throw new Error('没有标注') },
        loadMask: async () => { throw new Error('没有蒙版') },
      },
    )
    expect(result).toMatchObject({ width: 4, height: 3 })
    expect([...result!.data.slice(0, 8)]).toEqual([1, 0, 0, 1, 1, 0, 0, 1])
    expect([...result!.data.slice(8)].every((value) => value === 0)).toBe(true)
  })

  it.each(['region', 'full'] as const)('%s 执行器可以合成不同传递函数与参考白的线性瓦片', async (kind) => {
    const document = createImageEditDocumentV3({ width: 1, height: 1 })
    document.layers = [
      createImageEditRasterLayerV3('base', 'PQ底图', 'sha256:base'),
      createImageEditRasterLayerV3('source', '浮点图层', 'sha256:source'),
    ]
    const plan = compileImageEditRenderPlanV3(document, registry, 'export')
    const context = {
      size: document.geometry,
      registry,
      createTransparent: (region: ImageEditRect) => filled(region, [0, 0, 0, 0]),
      loadRaster: async (node: { layerId: string }) => createFloat32PremultipliedRgbaTile(
        1, 1, 'linear-light', new Float32Array(node.layerId === 'base'
          ? [0, 0, 0, 1] : [1, 0.5, 0.25, 0.5]),
        'rec2020', node.layerId === 'base' ? 'pq' : 'linear', node.layerId === 'base' ? 100 : 200,
      ),
      rasterizeAnnotations: async () => { throw new Error('没有标注') },
      loadMask: async () => { throw new Error('没有蒙版') },
    }
    const result = kind === 'region'
      ? await executeImageEditCpuRenderRegionPlanV3(plan, { x: 0, y: 0, width: 1, height: 1 }, context)
      : await executeImageEditCpuRenderPlanV3(plan, context)
    expect(result).toMatchObject({ transferFunction: 'pq', referenceWhiteNits: 100 })
    expect([...result!.data]).toEqual([2, 1, 0.5, 1])
  })

  it('感知域转换先解码原传递函数，再转换参考白，保持 PQ 绝对亮度', () => {
    const alpha = 0.5
    const code = encodeTransferFunctionV3(4, 'pq', 100)
    const source = createFloat32PremultipliedRgbaTile(
      1, 1, 'perceptual-working', new Float32Array([code * alpha, code * alpha, code * alpha, alpha]),
      'rec2020', 'pq', 100,
    )
    const target = { colorDomain: 'perceptual-working', workingSpace: 'rec2020',
      transferFunction: 'linear', referenceWhiteNits: 200 } as const
    const converted = convertFloat32TileColorContractV3(source, target)
    expect([...converted.data]).toEqual([expect.closeTo(1, 5), expect.closeTo(1, 5), expect.closeTo(1, 5), alpha])
    const restored = convertFloat32TileColorContractV3(converted, source)
    expect(restored.data[0]).toBeCloseTo(source.data[0], 6)
    expect(source.transferFunction).toBe('pq')
  })

  it('不放宽底层合成器对不兼容瓦片的校验', () => {
    const source = filled({ x: 0, y: 0, width: 1, height: 1 }, [1, 0, 0, 1])
    expect(() => compositePremultipliedTilesV3(source, { ...source, transferFunction: 'linear' }, 'normal'))
      .toThrow('合成瓦片的尺寸或颜色域不一致')
  })
})
