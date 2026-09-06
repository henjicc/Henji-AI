import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createFloat32PremultipliedRgbaTile, ImageEditResourceBudget } from '@/core/imageEdit/v3'
import { createImageEditorV3SparseRasterPlan } from './brushRegion'
import { prepareImageEditorV3ExportRender } from './capabilities'
import { loadImageEditorRasterRegionV3 } from './rasterRegion'
import { description } from './renderExportTestFixtures'

const SOURCE = `sha256:${'1'.repeat(64)}` as const, BRUSH = `sha256:${'2'.repeat(64)}` as const
function tile(width: number, height: number, rgba: number[]) {
  const pixels = new Float32Array(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i)
  return createFloat32PremultipliedRgbaTile(width, height, 'linear-light', pixels, 'srgb', 'srgb', 203)
}
function fixture() {
  const document = createImageEditDocumentV3({ width: 1024, height: 1, sourceResourceId: SOURCE })
  const layer = document.layers[0]
  if (layer.type !== 'raster') throw new Error('需要栅格图层')
  layer.tiles['0/1/0'] = BRUSH
  const { plan } = prepareImageEditorV3ExportRender(document, description(1024, 1))
  const sparsePlan = createImageEditorV3SparseRasterPlan(plan, document.geometry,
    [{ resourceRef: BRUSH, byteLength: 8192, mediaType: 'application/x-henji-brush-tile-v3' }],
    new Map([[SOURCE, { width: 1024, height: 1 }]]))
  const node = plan.nodes.find((item) => item.definitionId === 'source.raster')!
  const controller = new AbortController(), budget = new ImageEditResourceBudget()
  const loadSource = vi.fn(async (_resourceId: string, _region: { x: number; y: number; width: number; height: number }, mip: number) =>
    tile(1, 1, mip === 0 ? [1, 0, 0, 1] : [0, 0, 1, 1]))
  const readBrushTiles = vi.fn(async () => ({ tiles: [{ tileKey: '0/1/0', tile: tile(512, 1, [0, 0, 0, 0]) }] }))
  const options = { document, node, sparsePlan, budget, signal: controller.signal, mip: 10,
    region: { x: 0, y: 0, width: 1, height: 1 }, loadSource, dependencies: { readBrushTiles } }
  return { options, controller, budget, loadSource, readBrushTiles }
}

describe('CPU共享像素源的低mip边界读取与释放', () => {
  it('共享图片源的两个节点分别应用自己的画笔，不污染共用原图缓存', async () => {
    const value = fixture(), original = tile(1, 1, [0, 0, 1, 1])
    const first = { ...value.options, loadSource: async () => original }
    const secondNode = { ...first.node, id: 'same-source-other-layer' }
    const second = { ...first, node: secondNode,
      sparsePlan: { ...first.sparsePlan,
        byNodeId: new Map([[secondNode.id, first.sparsePlan.byNodeId.get(first.node.id)!]]),
        extentByNodeId: new Map([[secondNode.id, { width: 1024, height: 1 }]]) },
      dependencies: { readBrushTiles: async () => ({ tiles: [{ tileKey: '0/1/0', tile: tile(512, 1, [0, 1, 0, 1]) }] }) } }
    expect([...(await loadImageEditorRasterRegionV3(first)).data]).toEqual([0, 0, 0.5, 0.5])
    expect([...(await loadImageEditorRasterRegionV3(second)).data]).toEqual([0, 0.5, 0.5, 1])
    expect([...original.data]).toEqual([0, 0, 1, 1])
    expect(value.budget.snapshot().leaseCount).toBe(0)
  })

  it('透明覆盖只清除其拥有的半个像素足迹，其余半边读取真实mip0而非低mip蓝底', async () => {
    const value = fixture()
    const result = await loadImageEditorRasterRegionV3(value.options)
    expect([...result.data]).toEqual([0.5, 0, 0, 0.5])
    expect(value.loadSource.mock.calls).toEqual([[SOURCE, { x: 0, y: 0, width: 1, height: 1 }, 10],
      [SOURCE, { x: 511, y: 0, width: 1, height: 1 }, 0]])
    expect(value.budget.snapshot().leaseCount).toBe(0)
  })

  it('边界mip0读取不响应取消时也立即拒绝并归还临时解码预算；迟到拒绝有接收者', async () => {
    const value = fixture()
    let rejectRead!: (error: Error) => void
    value.loadSource.mockImplementationOnce(async () => tile(1, 1, [0, 0, 1, 1]))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject }))
    const result = loadImageEditorRasterRegionV3(value.options)
    const rejection = expect(result).rejects.toThrow()
    await vi.waitFor(() => expect(value.loadSource).toHaveBeenCalledTimes(2))
    expect(value.budget.snapshot().totalBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024)
    value.controller.abort()
    await rejection
    expect(value.budget.snapshot().leaseCount).toBe(0)
    rejectRead(new Error('取消后的晚到读取失败'))
    await Promise.resolve()
  })

  it('坏存储瓦片明确失败且释放资源，不以透明像素掩盖错误', async () => {
    const value = fixture()
    value.readBrushTiles.mockResolvedValueOnce({ tiles: [{ tileKey: '0/1/0', tile: tile(511, 1, [0, 0, 0, 0]) }] })
    await expect(loadImageEditorRasterRegionV3(value.options)).rejects.toThrow('像素契约')
    expect(value.budget.snapshot().leaseCount).toBe(0)
  })
})
