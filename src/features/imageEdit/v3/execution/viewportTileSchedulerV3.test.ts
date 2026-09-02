import { describe, expect, it, vi } from 'vitest'

import { createTileRegion } from '@/core/imageEdit/v3/tileGeometry'
import { ImageEditResourceBudget } from '@/core/imageEdit/v3/resourceBudget'
import type {
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3SourceTile,
} from '@/platform/contracts/imageEditorV3'
import { ImageEditorViewportTileCacheV3 } from './viewportTileCacheV3'
import {
  imageEditorViewportTileCacheKeyV3,
  planImageEditorViewportTilesV3,
  type ImageEditorViewportTileRequestV3,
} from './viewportTilePlannerV3'
import {
  ImageEditorViewportCancelledErrorV3,
  ImageEditorViewportSupersededErrorV3,
  ImageEditorViewportTileSchedulerV3,
} from './viewportTileSchedulerV3'

const resourceRef = `sha256:${'c'.repeat(64)}` as const
const secondaryResourceRef = `sha256:${'d'.repeat(64)}` as const
const tileBytes = 512 * 512 * 4

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
  const bytesPerSample = request.bitDepth / 8
  return {
    resourceRef: request.resourceRef,
    mip: request.mip,
    tileX: request.tileX,
    tileY: request.tileY,
    halo: request.halo,
    width: region.sourceRect.width,
    height: region.sourceRect.height,
    channels: 4,
    bitDepth: request.bitDepth,
    sampleFormat: request.bitDepth === 32 ? 'float' : 'uint',
    numericRange: request.bitDepth === 8
      ? 'unorm8'
      : request.bitDepth === 16 ? 'unorm16' : 'scene-linear',
    byteOrder: 'little-endian',
    rowStride: region.sourceRect.width * 4 * bytesPerSample,
    colorSpace: request.bitDepth === 32 ? 'scrgb' : 'srgb',
    transferFunction: request.bitDepth === 32 ? 'linear' : 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    originX: region.sourceRect.x,
    originY: region.sourceRect.y,
    pixels: new ArrayBuffer(region.sourceRect.width * region.sourceRect.height * 4 * bytesPerSample),
  }
}

function viewport(documentX = 0, documentY = 0, width = 512, height = 512) {
  return { documentX, documentY, width, height, zoom: 1, devicePixelRatio: 1 }
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30 && !predicate(); attempt += 1) await Promise.resolve()
  expect(predicate()).toBe(true)
}

function smallBudget(totalBytes: number): ImageEditResourceBudget {
  return new ImageEditResourceBudget({
    totalBytes,
    cpuCacheTargetBytes: totalBytes,
    gpuTargetBytes: 0,
  })
}

describe('图片编辑 V3 视口瓦片调度', () => {
  it('多图层资源共用一个 mip 与总预算，并按资源持有同一计划的租约', async () => {
    const documentSize = { width: 512, height: 512 }
    const resourceBudget = smallBudget(tileBytes)
    const cache = new ImageEditorViewportTileCacheV3({ maxBytes: tileBytes, resourceBudget })
    const readSourceTile = vi.fn(async (request) => sourceTile(request, documentSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'source-set',
      cache,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
      readSourceTile,
    })

    const frame = await scheduler.render({
      resourceRef,
      resourceRefs: [resourceRef, secondaryResourceRef],
      revision: 1,
      documentSize,
      viewport: viewport(),
      bitDepth: 8,
    })

    expect(frame.plan).toMatchObject({ mip: 1, degradedForBudget: true })
    expect(frame.tiles).toHaveLength(1)
    expect(frame.resourceTiles.get(resourceRef)).toHaveLength(1)
    expect(frame.resourceTiles.get(secondaryResourceRef)).toHaveLength(1)
    expect(readSourceTile).toHaveBeenCalledTimes(2)
    expect(new Set(readSourceTile.mock.calls.map(([request]) => request.resourceRef))).toEqual(
      new Set([resourceRef, secondaryResourceRef]),
    )
    frame.release()
    scheduler.dispose()
    expect(resourceBudget.snapshot().totalBytes).toBe(0)
  })

  it('200MP 高位深只通过命令读取当前视口的 15 个 mip 瓦片', async () => {
    const documentSize = { width: 20_000, height: 10_000 }
    const describePyramid = vi.fn(async () => pyramid(documentSize.width, documentSize.height))
    const readSourceTile = vi.fn(async (request) => sourceTile({
      resourceRef: request.resourceRef,
      mip: request.mip,
      tileX: request.tileX,
      tileY: request.tileY,
      halo: request.halo,
      bitDepth: request.bitDepth,
    }, documentSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: '200mp', describePyramid, readSourceTile,
    })

    const frame = await scheduler.render({
      resourceRef,
      revision: 1,
      documentSize,
      bitDepth: 32,
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 1_440,
        height: 900,
        zoom: 1_440 / 20_000,
        devicePixelRatio: 1,
      },
    })

    expect(frame.plan).toMatchObject({ mip: 3, degradedForBudget: false })
    expect(frame.tiles).toHaveLength(15)
    expect(readSourceTile).toHaveBeenCalledTimes(15)
    expect(readSourceTile.mock.calls.every(([request]) => request.mip === 3)).toBe(true)
    expect(readSourceTile.mock.calls.every(([request]) => request.bitDepth === 32)).toBe(true)
    expect(frame.tiles.reduce((total, tile) => total + tile.pixels.byteLength, 0))
      .toBeLessThan(documentSize.width * documentSize.height * 4)
    frame.release()
    scheduler.dispose()
  })

  it('不合作的旧 reader 不阻塞 latest-pending，替代时同步释放 in-flight', async () => {
    const documentSize = { width: 512, height: 512 }
    let firstSignal: AbortSignal | undefined
    const resourceBudget = smallBudget(tileBytes)
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes,
      resourceBudget,
    })
    const readSourceTile = vi.fn((request, signal?: AbortSignal) => {
      const normalized = {
        resourceRef: request.resourceRef,
        mip: request.mip,
        tileX: request.tileX,
        tileY: request.tileY,
        halo: request.halo,
        bitDepth: request.bitDepth,
      } as const
      if (readSourceTile.mock.calls.length === 1) {
        firstSignal = signal
        return new Promise<ImageEditorV3SourceTile>(() => undefined)
      }
      return Promise.resolve(sourceTile(normalized, documentSize))
    })
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'latest', cache,
      describePyramid: async () => pyramid(512, 512),
      readSourceTile,
    })

    const first = scheduler.render({
      resourceRef, revision: 1, documentSize, viewport: viewport(), bitDepth: 8,
    })
    const firstSettled = expect(first).rejects.toBeInstanceOf(ImageEditorViewportSupersededErrorV3)
    await flushUntil(() => readSourceTile.mock.calls.length === 1)
    const second = scheduler.render({
      resourceRef, revision: 2, documentSize, viewport: viewport(), bitDepth: 8,
    })
    const secondSettled = expect(second).rejects.toBeInstanceOf(ImageEditorViewportSupersededErrorV3)
    const latest = scheduler.render({
      resourceRef, revision: 3, documentSize, viewport: viewport(), bitDepth: 8,
    })

    expect(firstSignal?.aborted).toBe(true)
    expect(readSourceTile).toHaveBeenCalledTimes(1)
    expect(resourceBudget.snapshot()).toMatchObject({
      totalBytes: 0,
      byCategory: { 'in-flight': 0 },
    })
    await firstSettled
    await secondSettled
    const current = await latest
    expect(current).toMatchObject({ sequence: 3, revision: 3 })
    expect(readSourceTile).toHaveBeenCalledTimes(2)
    current.release()
    scheduler.dispose()
  })

  it('CPU admission 超限时增加 mip，而不是分配四个全分辨率瓦片', async () => {
    const documentSize = { width: 2_048, height: 2_048 }
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes,
      resourceBudget: smallBudget(tileBytes),
    })
    const readSourceTile = vi.fn(async (request) => sourceTile({
      resourceRef: request.resourceRef,
      mip: request.mip,
      tileX: request.tileX,
      tileY: request.tileY,
      halo: request.halo,
      bitDepth: request.bitDepth,
    }, documentSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'budget', cache, readSourceTile,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
    })

    const frame = await scheduler.render({
      resourceRef,
      revision: 1,
      documentSize,
      bitDepth: 8,
      viewport: viewport(0, 0, 1_024, 1_024),
    })
    expect(frame.plan).toMatchObject({ mip: 1, idealMip: 0, degradedForBudget: true })
    expect(frame.tiles).toHaveLength(1)
    expect(readSourceTile).toHaveBeenCalledWith(expect.objectContaining({ mip: 1 }), expect.any(AbortSignal))
    frame.release()
    scheduler.dispose()
  })

  it('在首个异步读取前预留全部 miss，并行解码后同步转换为 CPU 缓存账本', async () => {
    const documentSize = { width: 1_024, height: 512 }
    const resourceBudget = smallBudget(tileBytes * 2)
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 2,
      resourceBudget,
    })
    const observedInFlight: number[] = []
    const readSourceTile = vi.fn(async (request) => {
      observedInFlight.push(resourceBudget.snapshot().byCategory['in-flight'])
      return sourceTile(request, documentSize)
    })
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'reservation', cache, readSourceTile,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
    })

    const frame = await scheduler.render({
      resourceRef,
      revision: 1,
      documentSize,
      bitDepth: 8,
      viewport: viewport(0, 0, 1_024, 512),
    })
    expect(observedInFlight).toEqual([tileBytes * 2, tileBytes * 2])
    expect(resourceBudget.snapshot()).toMatchObject({
      totalBytes: tileBytes * 2,
      byCategory: { 'cpu-cache': tileBytes * 2, 'in-flight': 0 },
    })
    frame.release()
    scheduler.dispose()
    expect(resourceBudget.snapshot().totalBytes).toBe(0)
  })

  it('单个 session 最多并行四个瓦片读取', async () => {
    const documentSize = { width: 3_072, height: 512 }
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const readSourceTile = vi.fn(async (request) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return sourceTile(request, documentSize)
    })
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'decode-concurrency', readSourceTile,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
    })
    const pending = scheduler.render({
      resourceRef,
      revision: 1,
      documentSize,
      bitDepth: 8,
      viewport: viewport(0, 0, 3_072, 512),
    })
    await flushUntil(() => readSourceTile.mock.calls.length === 4)
    expect(peak).toBe(4)
    while (releases.length > 0) releases.shift()?.()
    await flushUntil(() => readSourceTile.mock.calls.length === 6)
    while (releases.length > 0) releases.shift()?.()
    const frame = await pending
    frame.release()
    scheduler.dispose()
  })

  it('严格拒绝错误几何的返回瓦片，并释放所有尚未提交的预留', async () => {
    const documentSize = { width: 1_024, height: 512 }
    const resourceBudget = smallBudget(tileBytes * 2)
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 2,
      resourceBudget,
    })
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'invalid-tile', cache,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
      readSourceTile: async (request) => ({ ...sourceTile(request, documentSize), originX: 1 }),
    })

    await expect(scheduler.render({
      resourceRef,
      revision: 1,
      documentSize,
      bitDepth: 8,
      viewport: viewport(0, 0, 1_024, 512),
    })).rejects.toThrow('计划几何或编码不一致')
    expect(resourceBudget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
    scheduler.dispose()
  })

  it('显式取消同步归还预算，永不结束的旧 reader 不阻塞下一次 render', async () => {
    const documentSize = { width: 512, height: 512 }
    let activeSignal: AbortSignal | undefined
    const resourceBudget = smallBudget(tileBytes)
    const cache = new ImageEditorViewportTileCacheV3({ maxBytes: tileBytes, resourceBudget })
    const readSourceTile = vi.fn((request, signal?: AbortSignal) => {
      if (readSourceTile.mock.calls.length === 1) {
        activeSignal = signal
        return new Promise<ImageEditorV3SourceTile>(() => undefined)
      }
      return Promise.resolve(sourceTile(request, documentSize))
    })
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'cancel', cache, readSourceTile,
      describePyramid: async () => pyramid(512, 512),
    })
    const pending = scheduler.render({
      resourceRef, revision: 1, documentSize, viewport: viewport(), bitDepth: 8,
    })
    const settled = expect(pending).rejects.toBeInstanceOf(ImageEditorViewportCancelledErrorV3)
    await flushUntil(() => readSourceTile.mock.calls.length === 1)

    scheduler.cancel()
    expect(activeSignal?.aborted).toBe(true)
    expect(resourceBudget.snapshot().totalBytes).toBe(0)
    await settled

    const recovered = await scheduler.render({
      resourceRef, revision: 2, documentSize, viewport: viewport(), bitDepth: 8,
    })
    expect(recovered.revision).toBe(2)
    expect(readSourceTile).toHaveBeenCalledTimes(2)
    recovered.release()
    scheduler.dispose()
  })

  it('dispose 同步归还运行中 job 的缓存命中 lease 与读取预留', async () => {
    const documentSize = { width: 1_024, height: 512 }
    const descriptor = pyramid(documentSize.width, documentSize.height)
    const resourceBudget = smallBudget(tileBytes * 2)
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 2,
      resourceBudget,
    })
    const initialPlan = planImageEditorViewportTilesV3({
      resourceRef,
      documentSize,
      pyramid: descriptor,
      bitDepth: 8,
      viewport: viewport(),
    })
    cache.insertAndLease(
      initialPlan.tiles[0],
      sourceTile(initialPlan.tiles[0], documentSize),
    )?.release()
    const readSourceTile = vi.fn(() => new Promise<ImageEditorV3SourceTile>(() => undefined))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'dispose-running', cache, readSourceTile,
      describePyramid: async () => descriptor,
    })
    const pending = scheduler.render({
      resourceRef,
      revision: 1,
      documentSize,
      bitDepth: 8,
      viewport: viewport(0, 0, 1_024, 512),
    })
    const settled = expect(pending).rejects.toThrow('视口瓦片会话已经释放')
    await flushUntil(() => readSourceTile.mock.calls.length === 1)
    expect(scheduler.cacheSnapshot().leasedEntryCount).toBe(1)
    expect(resourceBudget.snapshot().byCategory['in-flight']).toBe(tileBytes)

    scheduler.dispose()
    expect(resourceBudget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
    expect(scheduler.cacheSnapshot()).toMatchObject({ usedBytes: 0, entryCount: 0 })
    await settled
  })

  it('平移复用缓存，超过 LRU 上限后才重新读取旧瓦片', async () => {
    const documentSize = { width: 1_536, height: 512 }
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 2,
      resourceBudget: smallBudget(tileBytes * 2),
    })
    const readSourceTile = vi.fn(async (request) => sourceTile({
      resourceRef: request.resourceRef,
      mip: request.mip,
      tileX: request.tileX,
      tileY: request.tileY,
      halo: request.halo,
      bitDepth: request.bitDepth,
    }, documentSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'lru', cache, readSourceTile,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
    })
    const renderAt = async (documentX: number) => {
      const frame = await scheduler.render({
        resourceRef,
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
    expect(readSourceTile).toHaveBeenCalledTimes(4)
    expect(readSourceTile.mock.calls.map(([request]) => request.tileX)).toEqual([0, 1, 2, 0])
    scheduler.dispose()
  })

  it('halo 进入真实 tile 请求，dispose 会释放所有帧 lease 与 CPU 账本', async () => {
    const documentSize = { width: 1_024, height: 1_024 }
    const resourceBudget = smallBudget(tileBytes * 4)
    const cache = new ImageEditorViewportTileCacheV3({
      maxBytes: tileBytes * 4,
      resourceBudget,
    })
    const readSourceTile = vi.fn(async (request) => sourceTile({
      resourceRef: request.resourceRef,
      mip: request.mip,
      tileX: request.tileX,
      tileY: request.tileY,
      halo: request.halo,
      bitDepth: request.bitDepth,
    }, documentSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'dispose', cache, readSourceTile,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
    })
    const frame = await scheduler.render({
      resourceRef,
      revision: 1,
      documentSize,
      bitDepth: 8,
      viewport: viewport(512, 512),
      haloDocumentPixels: 24,
    })
    expect(readSourceTile).toHaveBeenCalledWith(expect.objectContaining({ halo: 24 }), expect.any(AbortSignal))
    expect(scheduler.cacheSnapshot().leasedEntryCount).toBe(1)

    scheduler.dispose()
    expect(scheduler.cacheSnapshot()).toMatchObject({ disposed: true, usedBytes: 0, entryCount: 0 })
    expect(resourceBudget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
    frame.release()
  })

  it('自定义逆向源请求参与 admission，并在读取前完整校验几何与字节数', async () => {
    const documentSize = { width: 1_024, height: 512 }
    const readSourceTile = vi.fn(async (request) => sourceTile(request, documentSize))
    const scheduler = new ImageEditorViewportTileSchedulerV3({
      sessionId: 'inverse-resolver',
      readSourceTile,
      describePyramid: async () => pyramid(documentSize.width, documentSize.height),
    })
    const resolver = (candidate: { mip: number }) => {
      const region = createTileRegion(documentSize, { mip: candidate.mip, x: 0, y: 0 }, 0)
      const request = {
        resourceRef,
        mip: candidate.mip,
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
      resourceRef,
      revision: 1,
      documentSize,
      bitDepth: 8,
      viewport: viewport(512),
      resolveSourceTileRequests: resolver,
    })
    expect(readSourceTile).toHaveBeenCalledWith(
      expect.objectContaining({ tileX: 0 }),
      expect.any(AbortSignal),
    )
    frame.release()

    await expect(scheduler.render({
      resourceRef,
      revision: 2,
      documentSize,
      bitDepth: 8,
      viewport: viewport(512),
      resolveSourceTileRequests: (candidate) => resolver(candidate).map((request) => ({
        ...request,
        estimatedBytes: request.estimatedBytes + 1,
      })),
    })).rejects.toThrow('无效源瓦片请求')
    expect(readSourceTile).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })
})
