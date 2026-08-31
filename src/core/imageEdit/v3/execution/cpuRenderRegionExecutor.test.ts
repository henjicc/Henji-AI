import { describe, expect, it } from 'vitest'

import { createImageEditDocumentV3, createImageEditGroupLayerV3 } from '../documentFactory'
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
    group.mask = { resourceId: `sha256:${'b'.repeat(64)}`, inverted: false }
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
