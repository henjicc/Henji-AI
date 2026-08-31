import { describe, expect, it } from 'vitest'

import type { ImageEditBrushTileChangeV3 } from '@/core/imageEdit/v3/brush/contracts'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import { RasterBrushCommittedOverlayCacheV3 } from './rasterBrushCommittedOverlayV3'

function change(tileKey: string, x: number, value: number): ImageEditBrushTileChangeV3 {
  return {
    tileKey,
    coordinate: { mip: 0, x, y: 0 },
    tile: createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([value, value, value, 1]),
    ),
    oldResource: null,
    newRawByteSize: 16,
  }
}

describe('RasterBrushCommittedOverlayCacheV3', () => {
  it('按 tileKey 保留坐标，相同内容资源不会互相覆盖，并由基础帧 revision 接管', () => {
    const cache = new RasterBrushCommittedOverlayCacheV3()
    const left = change('0/0/0', 0, 0.5)
    const right = change('0/1/0', 1, 0.5)
    const sharedResourceId = `sha256:${'a'.repeat(64)}`
    cache.commit({
      documentId: 'document',
      layerId: 'layer',
      revision: 3,
      changes: [left, right],
      persisted: [
        { tileKey: left.tileKey, resourceId: sharedResourceId, byteSize: 12 },
        { tileKey: right.tileKey, resourceId: sharedResourceId, byteSize: 12 },
      ],
    })

    const tiles = cache.tilesForLayer({
      documentId: 'document',
      layerId: 'layer',
      tileResources: {
        [left.tileKey]: sharedResourceId,
        [right.tileKey]: sharedResourceId,
      },
    })
    expect([...tiles.keys()]).toEqual([left.tileKey, right.tileKey])
    expect([...tiles.values()].map(({ coordinate }) => coordinate.x)).toEqual([0, 1])

    cache.releaseThrough('document', 2)
    expect(cache.size).toBe(2)
    cache.releaseThrough('document', 3)
    expect(cache.size).toBe(0)
    expect(cache.retainedByteSize).toBe(0)
  })

  it('同时限制缓存条目数与 Float32 字节数，并丢弃文档已不再引用的瓦片', () => {
    const cache = new RasterBrushCommittedOverlayCacheV3(2, 32)
    const changes = [
      change('0/0/0', 0, 0.1),
      change('0/1/0', 1, 0.2),
      change('0/2/0', 2, 0.3),
    ]
    changes.forEach((entry, index) => cache.commit({
      documentId: 'document',
      layerId: 'layer',
      revision: index + 1,
      changes: [entry],
      persisted: [{ tileKey: entry.tileKey, resourceId: `resource-${index}`, byteSize: 8 }],
    }))

    expect(cache.size).toBe(2)
    expect(cache.retainedByteSize).toBe(32)
    const tiles = cache.tilesForLayer({
      documentId: 'document',
      layerId: 'layer',
      tileResources: { '0/2/0': 'resource-2' },
    })
    expect([...tiles.keys()]).toEqual(['0/2/0'])
    expect(cache.size).toBe(1)
    expect(cache.retainedByteSize).toBe(16)
  })
})
