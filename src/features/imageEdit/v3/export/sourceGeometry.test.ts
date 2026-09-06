import { describe, expect, it, vi } from 'vitest'
import {
  compileImageEditRenderPlanV3, createBuiltInImageEditRenderNodeRegistry,
  createImageEditDocumentV3, createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3'
import { prepareImageEditorExportSourceGeometryV3 } from './sourceGeometry'

const SOURCE = `sha256:${'a'.repeat(64)}` as const
const MASK = `sha256:${'b'.repeat(64)}` as const
const registry = createBuiltInImageEditRenderNodeRegistry()

describe('导出使用统一采样网格与独立源几何', () => {
  it('内容与不同尺寸完整蒙版各读真实尺寸，同求值mip均为identity', async () => {
    const document = createImageEditDocumentV3({ width: 128, height: 64 })
    const layer = createImageEditRasterLayerV3('layer', '源', SOURCE)
    layer.mask = { resourceId: MASK, inverted: false }
    document.layers = [layer]
    const readSourcePyramid = vi.fn(async (ref: string) => ({
      tileSize: 512 as const,
      levels: [{ mip: 0, width: ref === SOURCE ? 64 : 32, height: ref === SOURCE ? 32 : 16, columns: 1, rows: 1 }],
    }))
    const plan = compileImageEditRenderPlanV3(document, registry, 'export')
    const resolver = await prepareImageEditorExportSourceGeometryV3(plan, document.geometry, 2,
      new AbortController().signal, { readSourcePyramid })
    const source = plan.nodes.find((node) => node.definitionId === 'source.raster')!
    const composite = plan.nodes.find((node) => node.mask)!
    expect(resolver({ kind: 'content', node: source })).toEqual({
      size: { width: 16, height: 8 }, toEvaluation: [1, 0, 0, 1, 0, 0],
    })
    expect(resolver({ kind: 'mask', ownerNode: composite, reference: composite.mask! })).toEqual({
      size: { width: 8, height: 4 }, toEvaluation: [1, 0, 0, 1, 0, 0],
    })
    expect(resolver({ kind: 'content', node: composite })?.size).toEqual({ width: 32, height: 16 })
    expect(readSourcePyramid.mock.calls.map(([ref]) => ref)).toEqual([SOURCE, MASK])
  })

  it('大于画布的源加稀疏覆盖后仍保留源右侧，不退回画布大小', async () => {
    const document = createImageEditDocumentV3({ width: 2672, height: 1504 })
    const layer = createImageEditRasterLayerV3('wide', '宽源', SOURCE)
    layer.tiles = { '0/0/0': 'sha256:brush' }
    document.layers = [layer]
    const plan = compileImageEditRenderPlanV3(document, registry, 'export')
    const resolver = await prepareImageEditorExportSourceGeometryV3(plan, document.geometry, 0,
      new AbortController().signal, { readSourcePyramid: async () => ({ tileSize: 512,
        levels: [{ mip: 0, width: 3600, height: 549, columns: 8, rows: 2 }] }) })
    const source = plan.nodes.find((node) => node.definitionId === 'source.raster')!
    expect(resolver({ kind: 'content', node: source })?.size).toEqual({ width: 3600, height: 549 })
  })
})
