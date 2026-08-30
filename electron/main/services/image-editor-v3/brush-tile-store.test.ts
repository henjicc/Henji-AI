import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createFloat32MaskTile,
  createFloat32PremultipliedRgbaTile,
} from '../../../../src/core/imageEdit/v3/effects/contracts'
import {
  decodeImageEditBrushTileV3,
  encodeImageEditBrushTileV3,
  IMAGE_EDIT_BRUSH_TILE_MAX_RAW_BYTES_V3,
  IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3,
} from './brush-tile-codec'
import { ImageEditBrushTileStoreV3 } from './brush-tile-store'
import { ContentAddressedResourceStore } from './resource-store'

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-brush-tile-v3-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('图片编辑 V3 权威画笔瓦片', () => {
  it('RGBA 往返保留 Float32、颜色编码和预乘 Alpha 契约', async () => {
    const source = createFloat32PremultipliedRgbaTile(
      2,
      1,
      'linear-light',
      new Float32Array([-0.25, 1.5, 0.75, 1, 0.1, 0.2, 0.3, 0.5]),
      'display-p3',
      'pq',
      203,
    )

    const encoded = await encodeImageEditBrushTileV3(source)
    const decoded = await decodeImageEditBrushTileV3(encoded)

    expect(decoded).toMatchObject({
      storage: 'rgba-float32',
      width: 2,
      height: 1,
      colorDomain: 'linear-light',
      workingSpace: 'display-p3',
      transferFunction: 'pq',
      referenceWhiteNits: 203,
      alpha: 'premultiplied',
    })
    expect([...decoded.data]).toEqual([...source.data])
  })

  it('蒙版往返保持单通道值，内容寻址持久化可复用同一资源', async () => {
    const resources = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
    const tiles = new ImageEditBrushTileStoreV3(resources)
    const source = createFloat32MaskTile(3, 2, new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.125]))

    const first = await tiles.persistTile(source)
    const second = await tiles.persistTile(source)
    const decoded = await tiles.readTile(first)

    expect(second).toEqual(first)
    expect(decoded.storage).toBe('mask-float32')
    expect([...decoded.data]).toEqual([...source.data])
    expect(first.resourceId).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.byteSize).toBeGreaterThan(80)
  })

  it('拒绝非有限像素、越界尺寸和不合法蒙版值', async () => {
    const invalidRgba = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([Number.POSITIVE_INFINITY, 0, 0, 1]),
    )
    await expect(encodeImageEditBrushTileV3(invalidRgba)).rejects.toThrow('finite')

    expect(() => createFloat32MaskTile(1, 1, new Float32Array([Number.NaN])))
      .toThrow('0～1')
    const tooWide = createFloat32MaskTile(513, 1, new Float32Array(513))
    await expect(encodeImageEditBrushTileV3(tooWide)).rejects.toThrow('512×512')
  })

  it('在 inflate 前验证头部长度，并以声明尺寸阻断压缩炸弹', async () => {
    const source = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([0, 0, 0, 0]),
    )
    const encoded = await encodeImageEditBrushTileV3(source)
    const invalidLength = Buffer.from(encoded)
    invalidLength.writeUInt32LE(8, 30)
    await expect(decodeImageEditBrushTileV3(invalidLength)).rejects.toThrow('raw byte length')

    const oversizedRaw = Buffer.alloc(IMAGE_EDIT_BRUSH_TILE_MAX_RAW_BYTES_V3 + 4)
    const bombPayload = deflateRawSync(oversizedRaw)
    const bomb = Buffer.alloc(80 + bombPayload.byteLength)
    encoded.subarray(0, 80).copy(bomb)
    bomb.writeUInt16LE(512, 16)
    bomb.writeUInt16LE(512, 18)
    bomb.writeUInt32LE(IMAGE_EDIT_BRUSH_TILE_MAX_RAW_BYTES_V3, 30)
    bomb.writeUInt32LE(bombPayload.byteLength, 34)
    bombPayload.copy(bomb, 80)
    await expect(decodeImageEditBrushTileV3(bomb)).rejects.toThrow('Invalid compressed brush tile')
  })

  it('拒绝资源超限、引用长度不符和内容寻址哈希损坏', async () => {
    const resources = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
    const tiles = new ImageEditBrushTileStoreV3(resources)
    const source = createFloat32MaskTile(1, 1, new Float32Array([0.5]))
    const reference = await tiles.persistTile(source)

    await expect(tiles.readTile({ ...reference, byteSize: reference.byteSize + 1 }))
      .rejects.toThrow('byte length')
    await expect(tiles.readTile({ ...reference, byteSize: IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3 + 1 }))
      .rejects.toThrow('byte length')

    const resourcePath = resources.getFilesystemPath(reference.resourceId as `sha256:${string}`)
    const bytes = await fsp.readFile(resourcePath)
    bytes[bytes.length - 1] ^= 0xff
    await fsp.writeFile(resourcePath, bytes)
    await expect(tiles.readTile(reference)).rejects.toThrow('hash mismatch')
  })

  it('编码、持久化和读取均响应 AbortSignal，失败后不会遗留租约', async () => {
    const resources = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
    const tiles = new ImageEditBrushTileStoreV3(resources)
    const source = createFloat32MaskTile(1, 1, new Float32Array([1]))
    const reference = await tiles.persistTile(source)
    const controller = new AbortController()
    controller.abort()

    await expect(encodeImageEditBrushTileV3(source, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    await expect(tiles.persistTile(source, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    await expect(tiles.readTile(reference, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })

    const collected = await resources.garbageCollect(new Set(), { minimumAgeMs: 0 })
    expect(collected.deleted).toContain(reference.resourceId)
    expect(collected.retainedByLease).toEqual([])
  })
})
