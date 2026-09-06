import { describe, expect, it, vi } from 'vitest'

import { createTileRegion, ImageEditResourceBudget } from '@/core/imageEdit/v3'
import type {
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3SourceTile,
} from '@/platform/contracts/imageEditorV3'
import { ImageEditorViewportTileCacheV3 } from './viewportTileCacheV3'
import {
  imageEditorViewportTileCacheKeyV3,
  type ImageEditorViewportTileRequestV3,
} from './viewportTilePlannerV3'
import { ImageEditorViewportTileSchedulerV3 } from './viewportTileSchedulerV3'

const RESOURCE = `sha256:${'c'.repeat(64)}` as const
const TILE_BYTES = 512 * 512 * 4

function pyramid(width: number, height: number): ImageEditorV3PyramidDescriptor {
  const levels: ImageEditorV3PyramidDescriptor['levels'] = []
  for (let mip = 0; mip <= 30; mip += 1) {
    const levelWidth = Math.max(1, Math.ceil(width / (2 ** mip)))
    const levelHeight = Math.max(1, Math.ceil(height / (2 ** mip)))
    levels.push({
      mip,
      width: levelWidth,
      height: levelHeight,
      columns: Math.ceil(levelWidth / 512),
      rows: Math.ceil(levelHeight / 512),
    })
    if (levelWidth === 1 && levelHeight === 1) break
  }
  return { tileSize: 512, levels }
}

function sourceTile(
  request: Pick<ImageEditorViewportTileRequestV3,
  'resourceRef' | 'mip' | 'tileX' | 'tileY' | 'halo' | 'bitDepth'>,
  documentSize: { width: number; height: number },
): ImageEditorV3SourceTile {
  const region = createTileRegion(documentSize, {
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

function viewport(documentX = 0, documentY = 0) {
  return {
    documentX,
    documentY,
    width: 512,
    height: 512,
    zoom: 1,
    devicePixelRatio: 1,
  }
}

function budget(totalBytes: number): ImageEditResourceBudget {
  return new ImageEditResourceBudget({
    totalBytes,
    cpuCacheTargetBytes: totalBytes,
    gpuTargetBytes: 0,
  })
}

describe('图片编辑 V3 视口瓦片缓存与逆向请求', () => {
  it('平移复用缓存，超过 LRU 上限后才重新读取旧瓦片', async () => {
    const documentSize = { width: 1_536, height: 512 }
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: TILE_BYTES * 2,
      resourceBudget: budget(TILE_BYTES * 2),
    })
    const readSourceTile = vi.fn(async (request) => sourceTile(request, documentSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'lru',
      cache,
      readSourceTile,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
    })
    const renderAt = async (documentX: number) => {
      const frame = await scheduler.render({
        resourceRef: RESOURCE,
        revision: documentX,
        documentSize,
        bitDepth: 8,
        viewport: viewport(documentX),
      })
      frame.release()
    }
    await renderAt(0)
    await renderAt(512)
    await renderAt(1_024)
    await renderAt(512)
    expect(readSourceTile).toHaveBeenCalledTimes(3)
    await renderAt(0)
    expect(readSourceTile.mock.calls.map(([request]) => request.tileX)).toEqual([0, 1, 2, 0])
    scheduler.dispose()
  })

  it('halo进入真实请求，dispose释放帧租约与CPU账本', async () => {
    const documentSize = { width: 1_024, height: 1_024 }
    const resourceBudget = budget(TILE_BYTES * 4)
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: TILE_BYTES * 4,
      resourceBudget,
    })
    const readSourceTile = vi.fn(async (request) => sourceTile(request, documentSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'dispose',
      cache,
      readSourceTile,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
    })
    const frame = await scheduler.render({
      resourceRef: RESOURCE,
      revision: 1,
      documentSize,
      bitDepth: 8,
      viewport: viewport(512, 512),
      haloDocumentPixels: 24,
    })
    expect(readSourceTile).toHaveBeenCalledWith(
      expect.objectContaining({ halo: 24 }),
      expect.any(AbortSignal),
    )
    expect(scheduler.cacheSnapshot().leasedEntryCount).toBe(1)
    scheduler.dispose()
    expect(scheduler.cacheSnapshot()).toMatchObject({ disposed: true, usedBytes: 0, entryCount: 0 })
    expect(resourceBudget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
    frame.release()
  })

  it('自定义逆向源请求参与admission，读取前严格校验几何与字节数', async () => {
    const documentSize = { width: 1_024, height: 512 }
    const readSourceTile = vi.fn(async (request) => sourceTile(request, documentSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'inverse-resolver',
      readSourceTile,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
    })
    const resolver = (mip: number) => {
      const region = createTileRegion(documentSize, { mip, x: 0, y: 0 }, 0)
      const request = {
        resourceRef: RESOURCE,
        mip,
        tileX: 0,
        tileY: 0,
        halo: 0,
        bitDepth: 8 as const,
        width: region.sourceRect.width,
        height: region.sourceRect.height,
        originX: region.sourceRect.x,
        originY: region.sourceRect.y,
        estimatedBytes: region.sourceRect.width * region.sourceRect.height * 4,
      }
      return [{ ...request, key: imageEditorViewportTileCacheKeyV3(request) }]
    }
    const frame = await scheduler.render({
      resourceRef: RESOURCE,
      revision: 1,
      documentSize,
      bitDepth: 8,
      viewport: viewport(512),
      resolveSourceTileRequests: (candidate) => resolver(candidate.mip),
    })
    expect(readSourceTile).toHaveBeenCalledWith(
      expect.objectContaining({ tileX: 0 }),
      expect.any(AbortSignal),
    )
    frame.release()
    await expect(scheduler.render({
      resourceRef: RESOURCE,
      revision: 2,
      documentSize,
      bitDepth: 8,
      viewport: viewport(512),
      resolveSourceTileRequests: (candidate) => resolver(candidate.mip).map((request) => ({
        ...request,
        estimatedBytes: request.estimatedBytes + 1,
      })),
    })).rejects.toThrow('无效源瓦片请求')
    expect(readSourceTile).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })
})
