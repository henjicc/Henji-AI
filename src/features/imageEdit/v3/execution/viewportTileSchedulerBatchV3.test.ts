import { describe, expect, it, vi } from 'vitest'

import { createTileRegion } from '@/core/imageEdit/v3/tileGeometry'
import type {
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3SourceTile,
} from '@/platform/contracts/imageEditorV3'
import { ImageEditorViewportTileSchedulerV3 } from './viewportTileSchedulerV3'

const resourceRef = `sha256:${'e'.repeat(64)}` as const
const size = { width: 1_024, height: 512 }

function pyramid(): ImageEditorV3PyramidDescriptor {
  return {
    tileSize: 512,
    levels: [
      { mip: 0, width: 1_024, height: 512, columns: 2, rows: 1 },
      { mip: 1, width: 512, height: 256, columns: 1, rows: 1 },
    ],
  }
}

function tile(request: {
  resourceRef: typeof resourceRef
  mip: number
  tileX: number
  tileY: number
  halo: number
  bitDepth: 8 | 16 | 32
}): ImageEditorV3SourceTile {
  const region = createTileRegion(size, {
    mip: request.mip,
    x: request.tileX,
    y: request.tileY,
  }, request.halo)
  return {
    ...request,
    width: region.sourceRect.width,
    height: region.sourceRect.height,
    channels: 4,
    sampleFormat: 'uint',
    numericRange: 'unorm8',
    byteOrder: 'little-endian',
    rowStride: region.sourceRect.width * 4,
    colorSpace: 'srgb',
    transferFunction: 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    originX: region.sourceRect.x,
    originY: region.sourceRect.y,
    pixels: new ArrayBuffer(region.sourceRect.width * region.sourceRect.height * 4),
  }
}

describe('图片编辑 V3 批量瓦片调度', () => {
  it('生产读取路径把有序 miss 合并成有界批次并保持响应顺序', async () => {
    const readSourceTiles = vi.fn(async (request: {
      tiles: Array<Parameters<typeof tile>[0] & { priority: number }>
    }) => ({ tiles: request.tiles.map(tile) }))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'batch-reader',
      describePyramid: async () => pyramid(),
      readSourceTiles,
    })

    const frame = await scheduler.render({
      resourceRef,
      revision: 1,
      documentSize: size,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_024,
        height: 512,
        zoom: 1,
        devicePixelRatio: 1,
      },
      bitDepth: 8,
    })

    expect(readSourceTiles).toHaveBeenCalledOnce()
    expect(readSourceTiles.mock.calls[0]?.[0].tiles).toHaveLength(2)
    expect(readSourceTiles.mock.calls[0]?.[0].tiles.map((item) => item.priority)).toEqual([0, 1])
    expect(frame.tiles.map((item) => item.tileX)).toEqual([0, 1])
    frame.release()
    scheduler.dispose()
  })
})
