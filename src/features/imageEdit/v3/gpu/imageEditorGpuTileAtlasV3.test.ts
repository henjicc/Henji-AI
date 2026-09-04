import { describe, expect, it, vi } from 'vitest'
import type { Gpu } from 'vgpu'

import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import { ImageEditorGpuTileAtlasV3, float32ToFloat16 } from './imageEditorGpuTileAtlasV3'

const RESOURCE = `sha256:${'b'.repeat(64)}` as const

function fakeGpu() {
  const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
  const writeTexture = vi.fn()
  const gpu = {
    gpu: {
      limits: { maxTextureDimension2D: 8_192, maxTextureArrayLayers: 256 },
      queue: { writeTexture },
    },
    device: {
      createTexture: vi.fn(() => {
        const texture = { gpu: {}, destroy: vi.fn(), createView: vi.fn(() => ({})) }
        textures.push(texture)
        return texture
      }),
    },
  } as unknown as Gpu
  return { gpu, textures, writeTexture }
}

function tile(tileX: number, value = 128): ImageEditorV3SourceTile {
  return {
    resourceRef: RESOURCE, mip: 0, tileX, tileY: 0, halo: 1,
    width: 4, height: 4, channels: 4, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8',
    byteOrder: 'little-endian', rowStride: 16, colorSpace: 'srgb', transferFunction: 'srgb',
    alphaMode: 'straight', orientationApplied: true, originX: Math.max(0, tileX * 2 - 1), originY: 0,
    pixels: new Uint8Array(64).fill(value).buffer,
  }
}

describe('GPU tile atlas', () => {
  it('多瓦片使用同一 array texture 的不同 layer，局部上传不分配整图', () => {
    const { gpu, textures, writeTexture } = fakeGpu()
    const atlas = new ImageEditorGpuTileAtlasV3(gpu, { memoryBudgetBytes: 64 * 1024 * 1024 })
    const first = atlas.upload({
      resourceRef: RESOURCE, mip: 0, tileX: 0, tileY: 0, contentVersion: 'v1',
    }, tile(0))
    const second = atlas.upload({
      resourceRef: RESOURCE, mip: 0, tileX: 1, tileY: 0, contentVersion: 'v1',
    }, tile(1))

    expect(textures).toHaveLength(1)
    expect(first.texture).toBe(second.texture)
    expect(first.atlasLayer).not.toBe(second.atlasLayer)
    expect(writeTexture).toHaveBeenCalledTimes(2)
    expect(writeTexture.mock.calls[0]?.[3]).toEqual({ width: 4, height: 4, depthOrArrayLayers: 1 })
    first.destroy()
    expect(textures[0]?.destroy).not.toHaveBeenCalled()
    second.destroy()
    expect(textures[0]?.destroy).toHaveBeenCalledOnce()
    atlas.dispose()
  })

  it('设备 limit 或页预算不足时明确拒绝，供 runtime 回退 CPU', () => {
    const { gpu } = fakeGpu()
    expect(() => new ImageEditorGpuTileAtlasV3(gpu, {
      memoryBudgetBytes: 4 * 1024 * 1024,
      maxTextureDimension2D: 512,
    })).toThrow('maxTextureDimension2D')
    const atlas = new ImageEditorGpuTileAtlasV3(gpu, { memoryBudgetBytes: 512 * 1024 })
    expect(() => atlas.upload({
      resourceRef: RESOURCE, mip: 0, tileX: 0, tileY: 0, contentVersion: 'v1',
    }, tile(0))).toThrow('超出会话显存预算')
    atlas.dispose()
  })

  it('默认256MiB压力下只允许254个rgba8槽，释放页后可重新上传', () => {
    const { gpu, textures } = fakeGpu()
    const atlas = new ImageEditorGpuTileAtlasV3(gpu, { memoryBudgetBytes: 256 * 1024 * 1024 })
    const allocations = Array.from({ length: 254 }, (_, index) => atlas.upload({
      resourceRef: RESOURCE, mip: 0, tileX: index, tileY: 0, contentVersion: 'pressure-v1',
    }, tile(index)))

    expect(atlas.snapshot()).toMatchObject({ allocations: 254, pages: 16 })
    expect(() => atlas.upload({
      resourceRef: RESOURCE, mip: 0, tileX: 254, tileY: 0, contentVersion: 'pressure-v1',
    }, tile(254))).toThrow('超出会话显存预算')
    for (const allocation of allocations.slice(240)) allocation.destroy()
    expect(textures.at(-1)?.destroy).toHaveBeenCalledOnce()
    const rebound = atlas.upload({
      resourceRef: RESOURCE, mip: 0, tileX: 254, tileY: 0, contentVersion: 'pressure-v2',
    }, tile(254))
    expect(rebound.atlasLayer).toBeGreaterThanOrEqual(0)
    rebound.destroy()
    for (const allocation of allocations.slice(0, 240)) allocation.destroy()
    atlas.dispose()
  })

  it('Float32 HDR 上传量化为 rgba16float 时保留负值与超白', () => {
    expect(float32ToFloat16(2.5)).toBe(0x4100)
    expect(float32ToFloat16(-0.25)).toBe(0xb400)
    expect(float32ToFloat16(1)).toBe(0x3c00)
  })
})
