import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ResourceId,
  SourcePyramidDescriptor,
  SourceTile,
  SourceTileRequest,
} from './contracts'
import { DerivedDiskCache } from './derived-disk-cache'
import {
  ManagedSourcePyramid,
  type SourcePyramidTileDecoder,
  type SourcePyramidTileLayout,
} from './source-pyramid'

const RESOURCE_A = `sha256:${'a'.repeat(64)}` as ResourceId
const RESOURCE_B = `sha256:${'b'.repeat(64)}` as ResourceId
let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-source-pyramid-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

function request(resourceId = RESOURCE_A, mip = 0, tileX = 0, tileY = 0): SourceTileRequest {
  return { resourceId, mip, tileX, tileY, halo: 0, bitDepth: 8 }
}

function layout(width = 2, height = 2): SourcePyramidTileLayout {
  return { width, height, originX: 0, originY: 0, bitDepth: 8 }
}

function decodedTile(
  sourceRequest: SourceTileRequest,
  sourceLayout: SourcePyramidTileLayout,
  fill = 7,
): SourceTile {
  return {
    resourceId: sourceRequest.resourceId,
    mip: sourceRequest.mip,
    tileX: sourceRequest.tileX,
    tileY: sourceRequest.tileY,
    halo: 0,
    width: sourceLayout.width,
    height: sourceLayout.height,
    channels: 4,
    bitDepth: sourceLayout.bitDepth,
    sampleFormat: sourceLayout.bitDepth === 32 ? 'float' : 'uint',
    numericRange: sourceLayout.bitDepth === 32
      ? 'scene-linear'
      : sourceLayout.bitDepth === 16 ? 'unorm16' : 'unorm8',
    byteOrder: 'little-endian',
    rowStride: sourceLayout.width * 4 * (sourceLayout.bitDepth / 8),
    colorSpace: sourceLayout.bitDepth === 32 ? 'scrgb' : 'srgb',
    transferFunction: sourceLayout.bitDepth === 32 ? 'linear' : 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    originX: sourceLayout.originX,
    originY: sourceLayout.originY,
    pixels: Buffer.alloc(
      sourceLayout.width * sourceLayout.height * 4 * (sourceLayout.bitDepth / 8),
      fill,
    ),
  }
}

describe('ManagedSourcePyramid', () => {
  it('冷请求按需生成并原子发布，热请求直接命中派生缓存', async () => {
    const sourceLayout = layout()
    const decode: SourcePyramidTileDecoder = async (sourceRequest) => (
      decodedTile(sourceRequest, sourceLayout)
    )
    const decoder = vi.fn(decode)
    const pyramid = new ManagedSourcePyramid(new DerivedDiskCache(rootDir, 1024), decoder)

    const cold = await pyramid.readTile(request(), sourceLayout)
    const hot = await pyramid.readTile(request(), sourceLayout)

    expect(decoder).toHaveBeenCalledOnce()
    expect(cold.pixels.equals(hot.pixels)).toBe(true)
    expect(hot).toMatchObject({ width: 2, height: 2, orientationApplied: true })
  })

  it('并发同键只生产一次，一个等待者取消不会误杀仍在等待的请求', async () => {
    const sourceLayout = layout()
    let releaseDecode: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const gate = new Promise<void>((resolve) => { releaseDecode = resolve })
    let producerSignal: AbortSignal | undefined
    const decode: SourcePyramidTileDecoder = async (sourceRequest, signal) => {
      producerSignal = signal
      markStarted?.()
      await gate
      return decodedTile(sourceRequest, sourceLayout)
    }
    const decoder = vi.fn(decode)
    const pyramid = new ManagedSourcePyramid(new DerivedDiskCache(rootDir, 1024), decoder)
    const cancelled = new AbortController()

    const first = pyramid.readTile({ ...request(), signal: cancelled.signal }, sourceLayout)
    const second = pyramid.readTile(request(), sourceLayout)
    await started
    cancelled.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(producerSignal?.aborted).toBe(false)
    releaseDecode?.()

    expect((await second).pixels[0]).toBe(7)
    expect(decoder).toHaveBeenCalledOnce()
  })

  it('最后一个等待者取消会协作取消底层瓦片并等待原子单位停止', async () => {
    const sourceLayout = layout()
    let producerCancelled = false
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const decoder: SourcePyramidTileDecoder = (sourceRequest, signal) => new Promise((_resolve, reject) => {
      markStarted?.()
      signal.addEventListener('abort', () => {
        producerCancelled = true
        reject(new Error(`cancelled ${sourceRequest.resourceId}`))
      }, { once: true })
    })
    const pyramid = new ManagedSourcePyramid(new DerivedDiskCache(rootDir, 1024), decoder)
    const controller = new AbortController()

    const pending = pyramid.readTile({ ...request(), signal: controller.signal }, sourceLayout)
    await started
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(producerCancelled).toBe(true)
  })

  it('旧生产任务取消但尚未退出时，新请求不会加入已取消的 singleflight', async () => {
    const sourceLayout = layout()
    let finishCancelledProducer: (() => void) | undefined
    let markFirstStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    let decodeCount = 0
    const decoder: SourcePyramidTileDecoder = async (sourceRequest, signal) => {
      decodeCount += 1
      if (decodeCount > 1) return decodedTile(sourceRequest, sourceLayout, 9)
      markFirstStarted?.()
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { finishCancelledProducer = resolve }, { once: true })
      })
      throw new Error('old producer stopped')
    }
    const pyramid = new ManagedSourcePyramid(new DerivedDiskCache(rootDir, 1024), decoder)
    const controller = new AbortController()

    const oldRequest = pyramid.readTile({ ...request(), signal: controller.signal }, sourceLayout)
    await firstStarted
    controller.abort()
    const latestRequest = pyramid.readTile(request(), sourceLayout)

    expect((await latestRequest).pixels[0]).toBe(9)
    finishCancelledProducer?.()
    await expect(oldRequest).rejects.toMatchObject({ name: 'AbortError' })
    expect(decodeCount).toBe(2)
  })

  it('预热严格 coarse→fine、逐瓦片让出，并复用已发布缓存', async () => {
    const order: string[] = []
    const decoder: SourcePyramidTileDecoder = async (sourceRequest) => {
      order.push(`${sourceRequest.mip}:${sourceRequest.tileX}:${sourceRequest.tileY}`)
      const sourceLayout = sourceRequest.mip === 0 && sourceRequest.tileX === 1
        ? { ...layout(88, 512), originX: 512 }
        : layout(sourceRequest.mip === 0 ? 512 : sourceRequest.mip === 1 ? 300 : 150,
          sourceRequest.mip === 0 ? 512 : sourceRequest.mip === 1 ? 256 : 128)
      return decodedTile(sourceRequest, sourceLayout)
    }
    const descriptor: SourcePyramidDescriptor = {
      tileSize: 512,
      levels: [
        { mip: 0, width: 600, height: 512, columns: 2, rows: 1 },
        { mip: 1, width: 300, height: 256, columns: 1, rows: 1 },
        { mip: 2, width: 150, height: 128, columns: 1, rows: 1 },
      ],
    }
    const pyramid = new ManagedSourcePyramid(new DerivedDiskCache(rootDir, 4 * 1024 * 1024), decoder)
    const prewarmRequest = { resourceId: RESOURCE_A, bitDepth: 8 as const }

    expect(await pyramid.prewarm(prewarmRequest, descriptor)).toEqual({
      plannedTiles: 4,
      completedTiles: 4,
      truncated: false,
    })
    expect(order).toEqual(['2:0:0', '1:0:0', '0:0:0', '0:1:0'])
    await pyramid.prewarm(prewarmRequest, descriptor)
    expect(order).toHaveLength(4)
  })

  it('预热取消会在当前原子瓦片结束后停止，不继续排队后续层级', async () => {
    const controller = new AbortController()
    let decodeCount = 0
    const decoder: SourcePyramidTileDecoder = async (sourceRequest) => {
      decodeCount += 1
      setImmediate(() => controller.abort())
      return decodedTile(sourceRequest, layout())
    }
    const pyramid = new ManagedSourcePyramid(new DerivedDiskCache(rootDir, 1024), decoder)
    const descriptor: SourcePyramidDescriptor = {
      tileSize: 512,
      levels: [
        { mip: 0, width: 512, height: 512, columns: 1, rows: 1 },
        { mip: 1, width: 2, height: 2, columns: 1, rows: 1 },
      ],
    }

    await expect(pyramid.prewarm({
      resourceId: RESOURCE_A,
      bitDepth: 8,
      signal: controller.signal,
    }, descriptor)).rejects.toMatchObject({ name: 'AbortError' })
    expect(decodeCount).toBe(1)
  })

  it('将完整 raw mip 按紧密行跨度种为 512 瓦片且不调用源解码器', async () => {
    const level = { mip: 3, width: 600, height: 2, columns: 2, rows: 1 }
    const pixels = Buffer.alloc(level.width * level.height * 4)
    for (let y = 0; y < level.height; y += 1) {
      for (let x = 0; x < level.width; x += 1) pixels[(y * level.width + x) * 4] = x % 251
    }
    const decode: SourcePyramidTileDecoder = async () => { throw new Error('unexpected decode') }
    const decoder = vi.fn(decode)
    const pyramid = new ManagedSourcePyramid(
      new DerivedDiskCache(rootDir, 4 * 1024 * 1024),
      decoder,
    )

    expect(await pyramid.hasCompleteLevel(RESOURCE_A, level, 8)).toBe(false)
    expect(await pyramid.seedRawLevel({
      resourceId: RESOURCE_A,
      level,
      bitDepth: 8,
      rowStride: level.width * 4,
      pixels,
    })).toBe(2)
    expect(await pyramid.hasCompleteLevel(RESOURCE_A, level, 8)).toBe(true)
    const left = await pyramid.readTile({ resourceId: RESOURCE_A, mip: 3, tileX: 0, tileY: 0 }, {
      width: 512, height: 2, originX: 0, originY: 0, bitDepth: 8,
    })
    const right = await pyramid.readTile({ resourceId: RESOURCE_A, mip: 3, tileX: 1, tileY: 0 }, {
      width: 88, height: 2, originX: 512, originY: 0, bitDepth: 8,
    })
    expect(left.pixels[0]).toBe(0)
    expect(left.pixels[511 * 4]).toBe(511 % 251)
    expect(right.pixels[0]).toBe(512 % 251)
    expect(right.pixels[88 * 4]).toBe(512 % 251)
    expect(decoder).not.toHaveBeenCalled()
  })

  it('逐瓦片拼接有界 raw mip，复用缓存且在分配前拒绝超预算', async () => {
    const level = { mip: 3, width: 600, height: 2, columns: 2, rows: 1 }
    const decode: SourcePyramidTileDecoder = async (sourceRequest) => {
      const sourceLayout = sourceRequest.tileX === 0
        ? layout(512, 2)
        : { ...layout(88, 2), originX: 512 }
      return decodedTile(sourceRequest, sourceLayout, sourceRequest.tileX === 0 ? 11 : 22)
    }
    const decoder = vi.fn(decode)
    const pyramid = new ManagedSourcePyramid(
      new DerivedDiskCache(rootDir, 4 * 1024 * 1024),
      decoder,
    )
    const read = {
      resourceId: RESOURCE_A,
      level,
      bitDepth: 8 as const,
      maximumBytes: 600 * 2 * 4,
    }

    const pixels = await pyramid.readBoundedRawLevel(read)
    expect(pixels.subarray(0, 512 * 4).every((value) => value === 11)).toBe(true)
    expect(pixels.subarray(512 * 4, 600 * 4).every((value) => value === 22)).toBe(true)
    expect(decoder).toHaveBeenCalledTimes(2)
    await pyramid.readBoundedRawLevel(read)
    expect(decoder).toHaveBeenCalledTimes(2)
    await expect(pyramid.readBoundedRawLevel({
      ...read,
      maximumBytes: read.maximumBytes - 1,
    })).rejects.toThrow('exceeds its bounded allocation')
  })

  it('200MP 描述符受 tileBudget 约束，只创建单瓦片缓冲而非全帧 RGBA', async () => {
    const decodedByteLengths: number[] = []
    const decoder: SourcePyramidTileDecoder = async (sourceRequest) => {
      const sourceLayout = sourceRequest.mip === 6 ? layout(313, 157) : layout(512, 512)
      const tile = decodedTile(sourceRequest, sourceLayout)
      decodedByteLengths.push(tile.pixels.byteLength)
      return tile
    }
    const pyramid = new ManagedSourcePyramid(new DerivedDiskCache(rootDir, 2 * 1024 * 1024), decoder)
    const descriptor: SourcePyramidDescriptor = {
      tileSize: 512,
      levels: [
        { mip: 0, width: 20_000, height: 10_000, columns: 40, rows: 20 },
        { mip: 6, width: 313, height: 157, columns: 1, rows: 1 },
      ],
    }

    expect(await pyramid.prewarm({
      resourceId: RESOURCE_A,
      bitDepth: 8,
      tileBudget: 1,
    }, descriptor)).toEqual({ plannedTiles: 1, completedTiles: 1, truncated: true })
    expect(decodedByteLengths).toEqual([313 * 157 * 4])
    expect(decodedByteLengths[0]).toBeLessThan(512 * 512 * 4 + 1)
  })

  it('遵守全局缓存预算，逐出后再次请求会重新生成该瓦片', async () => {
    const onePixel = layout(1, 1)
    const decode: SourcePyramidTileDecoder = async (sourceRequest) => (
      decodedTile(sourceRequest, onePixel, sourceRequest.resourceId === RESOURCE_A ? 1 : 2)
    )
    const decoder = vi.fn(decode)
    const pyramid = new ManagedSourcePyramid(new DerivedDiskCache(rootDir, 4, 4), decoder)

    await pyramid.readTile(request(RESOURCE_A), onePixel)
    await pyramid.readTile(request(RESOURCE_B), onePixel)
    await pyramid.readTile(request(RESOURCE_A), onePixel)

    expect(decoder).toHaveBeenCalledTimes(3)
  })
})
