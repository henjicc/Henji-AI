import { describe, expect, it, vi } from 'vitest'
import { ImageEditResourceBudget, createImageEditDocumentV3, createImageEditRasterLayerV3, type ImageEditTransformV3 } from '@/core/imageEdit/v3'
import { loadImageEditorV3SourceRegion } from './sourceRegion'
import { renderImageEditorV3ExportTiles } from './renderExportTilesV3'
import { description, fakeSourcePyramidReader, fakeSourceReader, type FakeImage } from './renderExportTestFixtures'

const BASE = `sha256:${'a'.repeat(64)}` as const
const BAMBOO = `sha256:${'b'.repeat(64)}` as const
const WIDE = `sha256:${'c'.repeat(64)}` as const
const images = new Map<string, FakeImage>([
  [BASE, { width: 2672, height: 1504, pixel: () => [0, 0, 255, 255] }],
  [BAMBOO, { width: 1631, height: 1111, pixel: () => [255, 0, 0, 255] }],
  [WIDE, { width: 3600, height: 549, pixel: () => [0, 255, 0, 255] }],
])

describe('真实异尺寸图层的 CPU 导出源几何', () => {
  it('真实10层缩放及878MiB预览占用共存时，不把最大源ROI重复乘给全部节点', async () => {
    const dimensions = [[2672, 1504], [1522, 1520], [1631, 1111], [3600, 549], [1275, 1870],
      [933, 1068], [1809, 1597], [1748, 1816], [2019, 713], [1847, 872]]
    const transforms: ImageEditTransformV3[] = [
      [1, 0, 0, 1, 0, 0], [0.7240473061760841, 0, 0, 0.7236842105263158, 1161, 0],
      [1, 0, 0, 1, 0, 0], [0.7422222222222222, 0, 0, 0.7413479052823315, 0, 1097],
      [0.28, 0, 0, 0.2802139037433155, 2291, 0],
      [0.20471596998928188, 0, 0, 0.2050561797752809, 1328, 964],
      [0.8313985627418463, 0, 0, 0.8315591734502191, 11, 176],
      [0.7133867276887872, 0, 0, 0.7120044052863436, 1387, 211],
      [0.43684992570579495, 0, 0, 0.4375876577840112, 76, 394],
      [0.3595018949648078, 0, 0, 0.36009174311926606, 996, 514],
    ]
    const fixtureImages = new Map<string, FakeImage>()
    const document = createImageEditDocumentV3({ width: 2672, height: 1504 })
    dimensions.forEach(([width, height], index) => {
      const resourceRef = `sha256:${index.toString(16).repeat(64)}`
      fixtureImages.set(resourceRef, { width, height, pixel: () => [64, 64, 64, 255] })
      const layer = createImageEditRasterLayerV3(`layer-${index}`, `图层${index}`, resourceRef)
      layer.transform = transforms[index]
      document.layers.push(layer)
    })
    const budget = new ImageEditResourceBudget()
    const previewLease = budget.acquire('in-flight', 878 * 1024 * 1024)!
    expect(previewLease).not.toBeNull()
    let completed = 0
    try {
      for await (const _tile of renderImageEditorV3ExportTiles({
        document, resourceDescriptors: [], description: description(2672, 1504), tileSize: 512,
      }, { resourceBudget: budget, readSourceTile: fakeSourceReader(fixtureImages),
        readSourcePyramid: fakeSourcePyramidReader(fixtureImages) })) completed += 1
      expect(completed).toBe(18)
      expect(budget.snapshot()).toMatchObject({ totalBytes: previewLease.bytes, leaseCount: 1 })
    } finally { previewLease.release() }
    expect(budget.snapshot().totalBytes).toBe(0)
  }, 15_000)

  it('真实loader仅请求源覆盖的瓦片，源外区域透明补齐', async () => {
    const readSourceTile = vi.fn(fakeSourceReader(images))
    const dependencies = { readSourceTile, readSourcePyramid: fakeSourcePyramidReader(images) }
    const signal = new AbortController().signal
    const edge = await loadImageEditorV3SourceRegion(BAMBOO,
      { x: 1536, y: 1024, width: 512, height: 480 }, { width: 2672, height: 1504 },
      8, 'srgb', 'srgb', 203, signal, dependencies)
    expect(readSourceTile).toHaveBeenCalledTimes(1)
    expect(readSourceTile.mock.calls[0][0]).toMatchObject({ tileX: 3, tileY: 2 })
    expect([...edge.data.slice(0, 4)]).toEqual([1, 0, 0, 1])
    expect([...edge.data.slice(95 * 4, 96 * 4)]).toEqual([0, 0, 0, 0])
    expect([...edge.data.slice(87 * 512 * 4)].every((value) => value === 0)).toBe(true)
    readSourceTile.mockClear()
    const outside = await loadImageEditorV3SourceRegion(BAMBOO,
      { x: 2048, y: 0, width: 512, height: 512 }, { width: 2672, height: 1504 },
      8, 'srgb', 'srgb', 203, signal, dependencies)
    expect(readSourceTile).not.toHaveBeenCalled()
    expect([...outside.data].every((value) => value === 0)).toBe(true)
  })

  it('18块正式导出完成：小源恒等层不越界，大源缩放后的右侧内容不被文档尺寸裁掉', async () => {
    const document = createImageEditDocumentV3({ width: 2672, height: 1504, sourceResourceId: BASE })
    const bamboo = createImageEditRasterLayerV3('bamboo', '竹林', BAMBOO)
    const wide = createImageEditRasterLayerV3('wide', '宽幅元素', WIDE)
    wide.transform = [0.5, 0, 0, 0.5, 0, 0]
    document.layers.push(bamboo, wide)
    const samples = [[100, 100], [1700, 100], [2000, 100], [1500, 800], [1800, 1200]]
    const actual = new Map<string, number[]>()
    const readSourceTile = vi.fn(fakeSourceReader(images))
    let count = 0
    for await (const tile of renderImageEditorV3ExportTiles({
      document, resourceDescriptors: [], description: description(2672, 1504), tileSize: 512,
    }, { readSourceTile, readSourcePyramid: fakeSourcePyramidReader(images) })) {
      count += 1
      const bytes = tile.pixels instanceof Uint8Array ? tile.pixels : new Uint8Array(tile.pixels)
      for (const [x, y] of samples) {
        if (x < tile.x || y < tile.y || x >= tile.x + tile.width || y >= tile.y + tile.height) continue
        const offset = (y - tile.y) * tile.rowStride + (x - tile.x) * 4
        actual.set(`${x}/${y}`, [...bytes.slice(offset, offset + 4)])
      }
    }
    expect(count).toBe(18)
    expect([...actual.values()]).toHaveLength(5)
    expect(actual.get('100/100')).toEqual([0, 255, 0, 255])
    expect(actual.get('1700/100')).toEqual([0, 255, 0, 255])
    expect(actual.get('2000/100')).toEqual([0, 0, 255, 255])
    expect(actual.get('1500/800')).toEqual([255, 0, 0, 255])
    expect(actual.get('1800/1200')).toEqual([0, 0, 255, 255])
    for (const [request] of readSourceTile.mock.calls) {
      const source = images.get(request.resourceRef)!
      expect(request.tileX * 512).toBeLessThan(Math.ceil(source.width / 2 ** request.mip))
      expect(request.tileY * 512).toBeLessThan(Math.ceil(source.height / 2 ** request.mip))
    }
    expect(readSourceTile.mock.calls.some(([request]) => request.resourceRef === WIDE && request.tileX === 6)).toBe(true)
  })
})
