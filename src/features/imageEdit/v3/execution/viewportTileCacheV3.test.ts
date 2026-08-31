import { describe, expect, it, vi } from 'vitest'

import { ImageEditResourceBudget } from '@/core/imageEdit/v3/resourceBudget'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorViewportTileCacheV3 } from './viewportTileCacheV3'
import {
  imageEditorViewportTileCacheKeyV3,
  type ImageEditorViewportTileRequestV3,
} from './viewportTilePlannerV3'

const resourceRef = `sha256:${'b'.repeat(64)}` as const
const tileBytes = 512 * 512 * 4

function tile(tileX: number, width = 512, height = 512): ImageEditorV3SourceTile {
  return {
    resourceRef,
    mip: 0,
    tileX,
    tileY: 0,
    halo: 0,
    width,
    height,
    channels: 4,
    bitDepth: 8,
    sampleFormat: 'uint',
    numericRange: 'unorm8',
    byteOrder: 'little-endian',
    rowStride: width * 4,
    colorSpace: 'srgb',
    transferFunction: 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    originX: tileX * 512,
    originY: 0,
    pixels: new ArrayBuffer(width * height * 4),
  }
}

function request(tileX: number, width = 512, height = 512): ImageEditorViewportTileRequestV3 {
  const value: ImageEditorViewportTileRequestV3 = {
    key: '',
    resourceRef,
    mip: 0,
    tileX,
    tileY: 0,
    halo: 0,
    bitDepth: 8,
    width,
    height,
    originX: tileX * 512,
    originY: 0,
    estimatedBytes: width * height * 4,
  }
  value.key = imageEditorViewportTileCacheKeyV3(value)
  return value
}

function budget(totalBytes = 8 * tileBytes): ImageEditResourceBudget {
  return new ImageEditResourceBudget({
    totalBytes,
    cpuCacheTargetBytes: totalBytes,
    gpuTargetBytes: 0,
  })
}

describe('图片编辑 V3 视口 CPU 瓦片缓存', () => {
  it('按字节 LRU 逐出未租用条目，并为命中项更新热度', () => {
    const disposed = vi.fn()
    const resourceBudget = budget()
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 2,
      resourceBudget,
      onDisposeTile: disposed,
    })

    const requests = [request(0), request(1), request(2)]
    cache.insertAndLease(requests[0], tile(0))?.release()
    cache.insertAndLease(requests[1], tile(1))?.release()
    cache.lease(requests[0])?.release()
    cache.insertAndLease(requests[2], tile(2))?.release()

    expect(cache.has(requests[0].key)).toBe(true)
    expect(cache.has(requests[1].key)).toBe(false)
    expect(cache.has(requests[2].key)).toBe(true)
    expect(disposed).toHaveBeenCalledWith(expect.objectContaining({ tileX: 1 }))
    expect(cache.snapshot()).toMatchObject({ usedBytes: tileBytes * 2, entryCount: 2 })
    expect(resourceBudget.snapshot()).toMatchObject({
      totalBytes: tileBytes * 2,
      leaseCount: 2,
    })
  })

  it('lease 阻止逐出，delete/dispose 延迟到最后一次 release', () => {
    const disposed = vi.fn()
    const resourceBudget = budget()
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes,
      resourceBudget,
      onDisposeTile: disposed,
    })
    const first = request(0)
    const second = request(1)
    const lease = cache.insertAndLease(first, tile(0))
    expect(lease).not.toBeNull()
    expect(cache.admission([second])).toMatchObject({ admitted: false, availableBytes: 0 })
    cache.delete(first.key)
    expect(disposed).not.toHaveBeenCalled()
    expect(cache.has(first.key)).toBe(false)
    lease?.release()
    lease?.release()
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(cache.snapshot()).toMatchObject({ usedBytes: 0, entryCount: 0 })
    expect(resourceBudget.snapshot().totalBytes).toBe(0)
  })

  it('admission 保护本帧命中项，只把其他未租用条目计为可逐出', () => {
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 2,
      resourceBudget: budget(),
    })
    const requests = [request(0), request(1), request(2), request(3)]
    cache.insertAndLease(requests[0], tile(0))?.release()
    cache.insertAndLease(requests[1], tile(1))?.release()

    expect(cache.admission([requests[0], requests[2]])).toMatchObject({
      admitted: true,
      missingBytes: tileBytes,
      protectedBytes: tileBytes,
      evictableBytes: tileBytes,
      availableBytes: tileBytes,
    })
    expect(cache.admission([requests[0], requests[2], requests[3]])).toMatchObject({
      admitted: false,
      missingBytes: tileBytes * 2,
      protectedBytes: tileBytes,
      availableBytes: tileBytes,
    })
  })

  it('全局资源账本的其他在途内存会参与 admission', () => {
    const resourceBudget = budget(tileBytes * 2)
    const inFlight = resourceBudget.acquire('in-flight', tileBytes + 1)
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 4,
      resourceBudget,
    })

    const first = request(0)
    expect(cache.admission([first])).toMatchObject({ admitted: false })
    expect(cache.insertAndLease(first, tile(0))).toBeNull()
    inFlight?.release()
    const admitted = cache.insertAndLease(first, tile(0))
    expect(admitted).not.toBeNull()
    admitted?.release()
  })

  it('dispose 立即释放空闲项，仍被租用的项在 lease 归还时释放', () => {
    const disposed = vi.fn()
    const resourceBudget = budget()
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 2,
      resourceBudget,
      onDisposeTile: disposed,
    })
    const active = cache.insertAndLease(request(0), tile(0))
    cache.insertAndLease(request(1), tile(1))?.release()

    cache.dispose()
    expect(cache.snapshot()).toMatchObject({
      disposed: true,
      usedBytes: tileBytes,
      entryCount: 1,
      leasedEntryCount: 1,
    })
    expect(disposed).toHaveBeenCalledTimes(1)
    active?.release()
    expect(disposed).toHaveBeenCalledTimes(2)
    expect(cache.snapshot()).toMatchObject({ usedBytes: 0, entryCount: 0 })
    expect(resourceBudget.snapshot().totalBytes).toBe(0)
  })

  it('缺失和缓存命中都严格绑定计划几何与像素编码', () => {
    const cache = new ImageEditorViewportTileCacheV3({ maxBytes: tileBytes, resourceBudget: budget() })
    const planned = request(0)
    const malformed = { ...tile(0), originX: 1 }
    expect(() => cache.insertAndLease(planned, malformed)).toThrow('计划几何或编码不一致')
    expect(() => cache.admission([{ ...planned, key: 'bad' }])).toThrow('缓存键或几何不一致')

    const cached = tile(0)
    cache.insertAndLease(planned, cached)?.release()
    cached.transferFunction = 'linear'
    expect(() => cache.lease(planned)).toThrow('计划几何或编码不一致')
    cache.dispose()
  })

  it('读取前以 in-flight 预留，commit 或异常都会完整转换或释放账本', () => {
    const resourceBudget = budget(tileBytes)
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes,
      resourceBudget,
    })
    const planned = request(0)
    const invalidReservation = cache.reserveInFlight(planned)
    expect(resourceBudget.snapshot()).toMatchObject({
      totalBytes: tileBytes,
      byCategory: { 'in-flight': tileBytes },
    })
    expect(() => invalidReservation?.commit({ ...tile(0), rowStride: 1 })).toThrow(
      '计划几何或编码不一致',
    )
    expect(resourceBudget.snapshot().totalBytes).toBe(0)

    const reservation = cache.reserveInFlight(planned)
    const lease = reservation?.commit(tile(0))
    expect(lease).not.toBeNull()
    expect(resourceBudget.snapshot()).toMatchObject({
      totalBytes: tileBytes,
      byCategory: { 'cpu-cache': tileBytes, 'in-flight': 0 },
    })
    lease?.release()
    cache.dispose()
    expect(resourceBudget.snapshot().totalBytes).toBe(0)
  })

  it('释放回调抛错不会中断其余条目和资源账本清理', () => {
    const resourceBudget = budget(tileBytes * 2)
    const disposeTile = vi.fn(() => { throw new Error('dispose failed') })
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 2,
      resourceBudget,
      onDisposeTile: disposeTile,
    })
    cache.insertAndLease(request(0), tile(0))?.release()
    cache.insertAndLease(request(1), tile(1))?.release()

    expect(() => cache.dispose()).not.toThrow()
    expect(disposeTile).toHaveBeenCalledTimes(2)
    expect(cache.snapshot()).toMatchObject({ usedBytes: 0, entryCount: 0, disposed: true })
    expect(resourceBudget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
  })
})
