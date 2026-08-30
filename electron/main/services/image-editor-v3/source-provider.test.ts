import { once } from 'node:events'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadSharp } from '../image/sharp-loader'
import { ContentAddressedResourceStore } from './resource-store'
import { DerivedDiskCache } from './derived-disk-cache'
import { SharpSourceProvider } from './source-provider'

let rootDir = ''
let store: ContentAddressedResourceStore

function nclxBox(
  colorPrimaries: number,
  transferCharacteristics: number,
  matrixCoefficients: number,
  fullRange: boolean,
): Buffer {
  const box = Buffer.alloc(19)
  box.writeUInt32BE(box.byteLength, 0)
  box.write('colr', 4, 'ascii')
  box.write('nclx', 8, 'ascii')
  box.writeUInt16BE(colorPrimaries, 12)
  box.writeUInt16BE(transferCharacteristics, 14)
  box.writeUInt16BE(matrixCoefficients, 16)
  box[18] = fullRange ? 0x80 : 0
  return box
}

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-source-'))
  store = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('SharpSourceProvider', () => {
  it('从受管文件读取 metadata、代理与 512 区域瓦片', async () => {
    const width = 1024
    const height = 512
    const pixels = Buffer.alloc(width * height * 3)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3
        if (x < 512) {
          pixels[offset] = 240
          pixels[offset + 1] = 10
          pixels[offset + 2] = 20
        } else {
          pixels[offset] = 20
          pixels[offset + 1] = 30
          pixels[offset + 2] = 230
        }
      }
    }
    const encoded = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer()
    const resource = await store.putBuffer(encoded, { mediaType: 'image/png' })
    const provider = new SharpSourceProvider(store)

    const metadata = await provider.readMetadata(resource.id)
    expect(metadata).toMatchObject({ width, height, format: 'png', hasAlpha: false })
    const pyramid = await provider.describePyramid(resource.id)
    expect(pyramid.levels[0]).toMatchObject({ mip: 0, width, height, columns: 2, rows: 1 })
    expect(pyramid.levels.at(-1)).toMatchObject({ width: 1, height: 1 })

    const tile = await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 1, tileY: 0 })
    expect(tile).toMatchObject({ width: 512, height: 512, originX: 512, originY: 0, channels: 4 })
    expect([...tile.pixels.subarray(0, 4)]).toEqual([20, 30, 230, 255])

    const haloTile = await provider.readTile({
      resourceId: resource.id,
      mip: 0,
      tileX: 1,
      tileY: 0,
      halo: 16,
    })
    expect(haloTile).toMatchObject({ width: 528, height: 512, originX: 496 })
    expect([...haloTile.pixels.subarray(0, 4)]).toEqual([240, 10, 20, 255])
    expect([...haloTile.pixels.subarray(16 * 4, 16 * 4 + 4)]).toEqual([20, 30, 230, 255])

    const proxy = await provider.readFastProxy(resource.id, 256)
    expect(proxy).toMatchObject({ width: 256, height: 128, format: 'webp' })
    expect(proxy.bytes.byteLength).toBeGreaterThan(0)
  })

  it('快速代理按内容哈希和尺寸写入共享派生缓存，热请求不重复编码', async () => {
    const encoded = await sharp({
      create: { width: 128, height: 64, channels: 3, background: { r: 20, g: 60, b: 120 } },
    }).png().toBuffer()
    const resource = await store.putBuffer(encoded, { mediaType: 'image/png' })
    const cache = new DerivedDiskCache(path.join(rootDir, 'derived-cache'), 16 * 1024 * 1024)
    const put = vi.spyOn(cache, 'put')
    const get = vi.spyOn(cache, 'get')
    const provider = new SharpSourceProvider(store, { derivedCache: cache })

    const cold = await provider.readFastProxy(resource.id, 64)
    const hot = await provider.readFastProxy(resource.id, 64)

    expect(hot.bytes.equals(cold.bytes)).toBe(true)
    expect(get).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenCalledOnce()
  })

  it('16 位权威源默认返回 ushort 瓦片，不静默量化到 8 位', async () => {
    const width = 8
    const height = 4
    const encoded = await sharp({
      create: { width, height, channels: 3, background: { r: 187, g: 187, b: 187 } },
    }).toColourspace('rgb16').png().toBuffer()
    const resource = await store.putBuffer(encoded, { mediaType: 'image/png' })
    const sharpLoader = vi.fn(loadSharp)
    const provider = new SharpSourceProvider(store, { sharpLoader })

    expect(await provider.readMetadata(resource.id)).toMatchObject({ bitsPerSample: 16, hdr: false })
    const tile = await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 0, tileY: 0 })
    expect(tile).toMatchObject({
      width,
      height,
      channels: 4,
      bitDepth: 16,
      sampleFormat: 'uint',
      numericRange: 'unorm16',
      byteOrder: 'little-endian',
      rowStride: width * 4 * 2,
      colorSpace: 'srgb',
      transferFunction: 'srgb',
      alphaMode: 'straight',
      orientationApplied: false,
    })
    expect(tile.pixels.byteLength).toBe(width * height * 4 * 2)
    const hotTile = await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 0, tileY: 0 })
    expect(hotTile.pixels.equals(tile.pixels)).toBe(true)
    expect(sharpLoader).toHaveBeenCalledTimes(2)
  })

  it('边缘瓦片保持源坐标与紧密行跨度，不扩成完整 512 瓦片', async () => {
    const width = 600
    const height = 530
    const encoded = await sharp({
      create: { width, height, channels: 3, background: { r: 20, g: 60, b: 120 } },
    }).png().toBuffer()
    const resource = await store.putBuffer(encoded, { mediaType: 'image/png' })
    const provider = new SharpSourceProvider(store)

    const tile = await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 1, tileY: 1 })

    expect(tile).toMatchObject({
      width: 88,
      height: 18,
      originX: 512,
      originY: 512,
      rowStride: 88 * 4,
      orientationApplied: false,
    })
    expect(tile.pixels.byteLength).toBe(88 * 18 * 4)
  })

  it.each([
    { transferCharacteristics: 16, label: 'PQ' },
    { transferCharacteristics: 18, label: 'HLG' },
  ])('从 AVIF nclx 解析 $label CICP 并判定 HDR', async ({ transferCharacteristics }) => {
    const avif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 187, g: 187, b: 187 } },
    }).avif({ bitdepth: 10 }).toBuffer()
    const boundaryPadding = transferCharacteristics === 18
      ? Buffer.alloc(256 * 1024 - 10 - avif.byteLength)
      : Buffer.alloc(0)
    const encoded = Buffer.concat([
      avif,
      boundaryPadding,
      nclxBox(9, transferCharacteristics, 9, true),
    ])
    const resource = await store.putBuffer(encoded, { mediaType: 'image/avif' })
    const provider = new SharpSourceProvider(store)

    expect(await provider.readMetadata(resource.id)).toMatchObject({
      format: 'heif',
      cicp: {
        colorPrimaries: 9,
        transferCharacteristics,
        matrixCoefficients: 9,
        fullRange: true,
      },
      hdr: true,
    })
    expect(await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 0, tileY: 0 }))
      .toMatchObject({
        bitDepth: 32,
        sampleFormat: 'float',
        numericRange: 'scene-linear',
        colorSpace: 'scrgb',
        transferFunction: 'linear',
      })
    await expect(provider.readTile({
      resourceId: resource.id, mip: 0, tileX: 0, tileY: 0, bitDepth: 16,
    })).rejects.toThrow('Float32 scRGB')
    await expect(provider.readFastProxy(resource.id, 64)).rejects.toThrow('Float32 tile preview')
  })

  it.each([10, 12] as const)('%s 位 AVIF 保留真实位深，缺少 nclx 时不猜测 HDR', async (bitdepth) => {
    const encoded = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 187, g: 187, b: 187 } },
    }).avif({ bitdepth }).toBuffer()
    const resource = await store.putBuffer(encoded, { mediaType: 'image/avif' })
    const provider = new SharpSourceProvider(store)

    expect(await provider.readMetadata(resource.id)).toMatchObject({
      bitsPerSample: bitdepth,
      cicp: null,
      hdr: false,
    })
    expect(await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 0, tileY: 0 }))
      .toMatchObject({ bitDepth: 16, sampleFormat: 'uint', numericRange: 'unorm16' })
  })

  it('代理与瓦片都保留源坐标方向，由文档几何统一应用 EXIF 朝向', async () => {
    const encoded = await sharp({
      create: { width: 12, height: 6, channels: 3, background: { r: 20, g: 60, b: 120 } },
    }).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const resource = await store.putBuffer(encoded, { mediaType: 'image/jpeg' })
    const provider = new SharpSourceProvider(store)

    expect(await provider.readMetadata(resource.id)).toMatchObject({ width: 12, height: 6, orientation: 6 })
    expect(await provider.readFastProxy(resource.id, 64)).toMatchObject({ width: 12, height: 6 })
    expect(await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 0, tileY: 0 }))
      .toMatchObject({ width: 12, height: 6, originX: 0, originY: 0 })
  })

  it('metadata/proxy/tile/openOriginal 都在完整操作期间持有并释放资源 lease', async () => {
    const encoded = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 60, b: 120 } },
    }).png().toBuffer()
    const resource = await store.putBuffer(encoded, { mediaType: 'image/png' })
    const originalAcquire = store.acquireLease.bind(store)
    const released: boolean[] = []
    const acquire = vi.spyOn(store, 'acquireLease').mockImplementation(async (resourceIds) => {
      const lease = await originalAcquire(resourceIds)
      const releaseIndex = released.push(false) - 1
      return {
        resourceIds: lease.resourceIds,
        release: async () => {
          released[releaseIndex] = true
          await lease.release()
        },
      }
    })
    const provider = new SharpSourceProvider(store)

    await provider.readMetadata(resource.id)
    await provider.readFastProxy(resource.id, 64)
    await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 0, tileY: 0 })
    const original = await provider.openOriginal(resource.id)
    let streamedBytes = 0
    for await (const chunk of original) streamedBytes += chunk.byteLength

    expect(streamedBytes).toBe(encoded.byteLength)
    expect(acquire).toHaveBeenCalledTimes(4)
    expect(released).toEqual([true, true, true, true])
  })

  it('openOriginal 保持 lease 到流关闭，避免 GC 删除正在读取的源', async () => {
    const resource = await store.putBuffer(Buffer.alloc(128 * 1024, 7))
    const provider = new SharpSourceProvider(store)
    const stream = await provider.openOriginal(resource.id)

    const whileOpen = await store.garbageCollect(new Set(), { minimumAgeMs: 0 })
    expect(whileOpen.retainedByLease).toEqual([resource.id])
    stream.destroy()
    await once(stream, 'close')

    const afterClose = await store.garbageCollect(new Set(), { minimumAgeMs: 0 })
    expect(afterClose.deleted).toEqual([resource.id])
  })

  it('取消长耗时 Sharp 操作会 destroy 管线并释放 source lease', async () => {
    const resource = await store.putBuffer(Buffer.from('managed source'))
    let rejectOutput: ((error: unknown) => void) | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const destroy = vi.fn((error?: Error) => { rejectOutput?.(error) })
    const pipeline = {
      metadata: async () => ({ width: 1, height: 1, depth: 'uchar' }),
      resize: () => pipeline,
      toColourspace: () => pipeline,
      webp: () => pipeline,
      toBuffer: () => {
        markStarted?.()
        return new Promise<never>((_resolve, reject) => { rejectOutput = reject })
      },
      destroy,
    }
    type LoadedSharp = Awaited<ReturnType<typeof loadSharp>>
    const sharpFactory = (() => pipeline) as unknown as LoadedSharp
    const provider = new SharpSourceProvider(store, {
      sharpLoader: async () => sharpFactory,
    })
    const controller = new AbortController()

    const pending = provider.readFastProxy(resource.id, 64, controller.signal)
    await started
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalledOnce()
    expect((await store.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted)
      .toEqual([resource.id])
  })

  it('Sharp 加载期间取消也会销毁随后创建的管线并释放 source lease', async () => {
    const resource = await store.putBuffer(Buffer.from('managed source'))
    let resolveLoader: ((loaded: Awaited<ReturnType<typeof loadSharp>>) => void) | undefined
    let markLoaderStarted: (() => void) | undefined
    const loaderStarted = new Promise<void>((resolve) => { markLoaderStarted = resolve })
    const destroy = vi.fn()
    const toBuffer = vi.fn()
    const pipeline = {
      metadata: async () => ({ width: 1, height: 1, depth: 'uchar' }),
      resize: () => pipeline,
      toColourspace: () => pipeline,
      webp: () => pipeline,
      toBuffer,
      destroy,
    }
    type LoadedSharp = Awaited<ReturnType<typeof loadSharp>>
    const sharpFactory = (() => pipeline) as unknown as LoadedSharp
    const provider = new SharpSourceProvider(store, {
      sharpLoader: () => {
        markLoaderStarted?.()
        return new Promise<LoadedSharp>((resolve) => { resolveLoader = resolve })
      },
    })
    const controller = new AbortController()

    const pending = provider.readFastProxy(resource.id, 64, controller.signal)
    await loaderStarted
    controller.abort()
    resolveLoader?.(sharpFactory)

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalledOnce()
    expect(toBuffer).not.toHaveBeenCalled()
    expect((await store.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted)
      .toEqual([resource.id])
  })

  it('元数据缓存按最近使用保留固定数量，瓦片解码明确使用随机访问', async () => {
    type LoadedSharp = Awaited<ReturnType<typeof loadSharp>>
    const sequentialReads: Array<boolean | undefined> = []
    const sharpLoads = vi.fn(async (): Promise<LoadedSharp> => {
      const real = await loadSharp()
      const invoke = real as unknown as (...args: unknown[]) => ReturnType<LoadedSharp>
      return ((...args: unknown[]) => {
        const options = args[1] as { sequentialRead?: boolean } | undefined
        sequentialReads.push(options?.sequentialRead)
        return invoke(...args)
      }) as unknown as LoadedSharp
    })
    const resources = await Promise.all([10, 20, 30].map(async (red) => store.putBuffer(
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: red, g: 0, b: 0 } },
      }).png().toBuffer(),
    )))
    const provider = new SharpSourceProvider(store, {
      metadataCacheLimit: 2,
      sharpLoader: sharpLoads,
    })

    await provider.readMetadata(resources[0].id)
    await provider.readMetadata(resources[1].id)
    await provider.readMetadata(resources[0].id)
    await provider.readMetadata(resources[2].id)
    await provider.readMetadata(resources[1].id)
    expect(sharpLoads).toHaveBeenCalledTimes(4)

    sequentialReads.length = 0
    await provider.readFastProxy(resources[0].id, 64)
    expect(sequentialReads.at(-1)).toBe(true)

    sequentialReads.length = 0
    await provider.readTile({ resourceId: resources[0].id, mip: 0, tileX: 0, tileY: 0 })
    expect(sequentialReads.at(-1)).toBe(false)
  })

  it('首次并发 metadata 使用 singleflight，只执行一次 Sharp 读取', async () => {
    const encoded = await sharp({
      create: { width: 16, height: 8, channels: 3, background: { r: 20, g: 60, b: 120 } },
    }).png().toBuffer()
    const resource = await store.putBuffer(encoded, { mediaType: 'image/png' })
    type LoadedSharp = Awaited<ReturnType<typeof loadSharp>>
    let releaseLoader: (() => void) | undefined
    let markLoaderStarted: (() => void) | undefined
    const loaderStarted = new Promise<void>((resolve) => { markLoaderStarted = resolve })
    const loaderGate = new Promise<void>((resolve) => { releaseLoader = resolve })
    const realSharp = await loadSharp()
    const sharpLoader = vi.fn(async (): Promise<LoadedSharp> => {
      markLoaderStarted?.()
      await loaderGate
      return realSharp
    })
    const provider = new SharpSourceProvider(store, { sharpLoader, derivedCache: null })

    const first = provider.readMetadata(resource.id)
    const second = provider.readMetadata(resource.id)
    await loaderStarted
    releaseLoader?.()

    expect(await first).toMatchObject({ width: 16, height: 8, bitsPerSample: 8 })
    expect(await second).toMatchObject({ width: 16, height: 8, bitsPerSample: 8 })
    expect(sharpLoader).toHaveBeenCalledOnce()
  })
})
