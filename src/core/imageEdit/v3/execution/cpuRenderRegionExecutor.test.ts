import { createImageEditSparseMaskReferenceV3 } from '../layerTypes'
import { executeImageEditCpuRenderPlanV3 } from './cpuRenderPlanExecutor'
import { cropImageEditRgbaRegionV3 } from './affineTransform'
import { describe, expect, it } from 'vitest'

import { createImageEditEffectLayerV3, createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditGroupLayerV3 } from '../documentFactory'
import { createFloat32MaskTile, createFloat32PremultipliedRgbaTile } from '../effects/contracts'
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes'
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler'
import { executeImageEditCpuRenderRegionPlanV3 } from './cpuRenderRegionExecutor'

describe('图片编辑 V3 区域 RenderPlan 仿射执行', () => {
  it('图层组变换同时作用于组内容与组蒙版', async () => {
    const document = createImageEditDocumentV3({
      width: 4,
      height: 1,
      documentId: 'group-mask-transform',
      sourceResourceId: `sha256:${'a'.repeat(64)}`,
      idFactory: () => 'raster',
    })
    const group = createImageEditGroupLayerV3('group', '组')
    group.children = document.layers
    group.transform = [1, 0, 0, 1, 1, 0]
    group.mask = { ...createImageEditSparseMaskReferenceV3(`sha256:${'b'.repeat(64)}`, false), tiles: { '0/0/0': `sha256:${'b'.repeat(64)}` } }
    document.layers = [group]
    const registry = createBuiltInImageEditRenderNodeRegistry()
    const plan = compileImageEditRenderPlanV3(document, registry, 'export')
    const output = await executeImageEditCpuRenderRegionPlanV3(
      plan,
      { x: 0, y: 0, width: 4, height: 1 },
      {
        size: { width: 4, height: 1 },
        registry,
        createTransparent: (region) => createFloat32PremultipliedRgbaTile(
          region.width,
          region.height,
          'linear-light',
          new Float32Array(region.width * region.height * 4),
        ),
        loadRaster: async (_node, region) => {
          const data = new Float32Array(region.width * region.height * 4)
          for (let pixel = 0; pixel < region.width * region.height; pixel += 1) {
            data.set([1, 0, 0, 1], pixel * 4)
          }
          return createFloat32PremultipliedRgbaTile(
            region.width,
            region.height,
            'linear-light',
            data,
          )
        },
        rasterizeAnnotations: async (_node, region) => createFloat32PremultipliedRgbaTile(
          region.width,
          region.height,
          'linear-light',
          new Float32Array(region.width * region.height * 4),
        ),
        loadMask: async (_reference, _node, region) => createFloat32MaskTile(
          region.width,
          region.height,
          Float32Array.from({ length: region.width * region.height }, (_, index) => (
            region.x + index % region.width === 0 ? 1 : 0
          )),
        ),
      },
    )

    expect(output).not.toBeNull()
    expect(Array.from({ length: 4 }, (_, pixel) => output!.data[pixel * 4 + 3]))
      .toEqual([0, 1, 0, 0])
  })
})

it('共享 HSL 邻域跨任意分块保持完整文档金字塔网格（奇数尺寸）', async () => {
  const width = 129, height = 257
  const document = createImageEditDocumentV3({ width, height, sourceResourceId: `sha256:${'a'.repeat(64)}` })
  document.layers.push(createImageEditAdjustmentLayerV3('grade', '调整', 'color_grade', { hsl_hue_start: 340, hsl_hue_end: 60, hsl_hue_feather: 15, hsl_saturation: -40, hsl_blur: 100, hsl_sharpen: 20, vignette_amount: -25 }))
  const data = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([.02 + x / width * .25, .01 + (y % 13) / 13 * .12, .04, .7], (y * width + x) * 4)
  const source = createFloat32PremultipliedRgbaTile(width, height, 'linear-light', data)
  const registry = createBuiltInImageEditRenderNodeRegistry()
  const plan = compileImageEditRenderPlanV3(document, registry, 'export')
  const whole = await executeImageEditCpuRenderPlanV3(plan, { loadRaster: async () => source, rasterizeAnnotations: async () => source })
  const region = { x: 31, y: 65, width: 35, height: 67 }
  const result = await executeImageEditCpuRenderRegionPlanV3(plan, region, {
    size: { width, height }, registry,
    loadRaster: async (_node, requested) => cropImageEditRgbaRegionV3(source, { x: 0, y: 0, width, height }, requested),
    rasterizeAnnotations: async () => source,
    createTransparent: requested => createFloat32PremultipliedRgbaTile(requested.width, requested.height, 'linear-light', new Float32Array(requested.width * requested.height * 4)),
    loadMask: async () => { throw new Error('无蒙版') },
  })
  const reference = cropImageEditRgbaRegionV3(whole!, { x: 0, y: 0, width, height }, region)
  if (!result) throw new Error('Expected rendered region')
  result.data.forEach((value, i) => expect(value).toBeCloseTo(reference.data[i], 5))
})

it.each(['draft', 'stable', 'export'] as const)('%s 高斯完整网格与非对齐区域逐值相同，halo 不受 tile 尺寸影响', async quality => {
  const width = 129, height = 131
  const document = createImageEditDocumentV3({ width, height, sourceResourceId: `sha256:${'a'.repeat(64)}` })
  document.layers.push(createImageEditEffectLayerV3('gaussian', '高斯', 'gaussian_blur', { sigma_fraction_height: .08, axis: 'horizontal', edge_mode: 'transparent' }))
  const data = Float32Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 1 : (i % 31) / 31)
  const source = createFloat32PremultipliedRgbaTile(width, height, 'linear-light', data)
  const registry = createBuiltInImageEditRenderNodeRegistry()
  const plan = compileImageEditRenderPlanV3(document, registry, quality)
  const effect = plan.nodes.find(node => node.layerId === 'gaussian')!
  expect(effect.parameters.effectQuality).toBe(quality === 'export' ? 'final' : 'interactive')
  const whole = await executeImageEditCpuRenderPlanV3(plan, { loadRaster: async () => source, rasterizeAnnotations: async () => source })
  const region = { x: 31, y: 65, width: 35, height: 33 }
  const requested: object[] = []
  const result = await executeImageEditCpuRenderRegionPlanV3(plan, region, {
    size: { width, height }, registry,
    loadRaster: async (_node, input) => { requested.push(input); return cropImageEditRgbaRegionV3(source, { x: 0, y: 0, width, height }, input) },
    rasterizeAnnotations: async () => source,
    createTransparent: input => createFloat32PremultipliedRgbaTile(input.width, input.height, 'linear-light', new Float32Array(input.width * input.height * 4)),
    loadMask: async () => { throw new Error('无蒙版') },
  })
  expect(requested).not.toEqual([region])
  expect(result?.data).toEqual(cropImageEditRgbaRegionV3(whole!, { x: 0, y: 0, width, height }, region).data)
})

it('stable 的效果质量由请求显式选择，缓存指纹区分档位', () => {
  const document = createImageEditDocumentV3({ width: 129, height: 131, sourceResourceId: `sha256:${'a'.repeat(64)}` })
  document.layers.push(createImageEditEffectLayerV3('gaussian', '高斯', 'gaussian_blur', {}))
  const registry = createBuiltInImageEditRenderNodeRegistry()
  const interactive = compileImageEditRenderPlanV3(document, registry, 'stable', 'interactive')
  const final = compileImageEditRenderPlanV3(document, registry, 'stable', 'final')
  expect(interactive.outputHash).not.toBe(final.outputHash)
  expect(final.nodes.find(node => node.layerId === 'gaussian')?.parameters.effectQuality).toBe('final')
})
