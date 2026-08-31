import { describe, expect, it } from 'vitest'

import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorV3ExportSourceTileRequest } from './contracts'
import { loadImageEditorV3SourceRegion } from './sourceRegion'

const RESOURCE = `sha256:${'7'.repeat(64)}` as const

function sourceTile(bitDepth: 8 | 16 | 32): ImageEditorV3SourceTile {
  const channelBytes = bitDepth / 8
  return {
    resourceRef: RESOURCE,
    mip: 0,
    tileX: 0,
    tileY: 0,
    halo: 0,
    width: 1,
    height: 1,
    channels: 4,
    bitDepth,
    sampleFormat: bitDepth === 32 ? 'float' : 'uint',
    numericRange: bitDepth === 32 ? 'scene-linear' : bitDepth === 16 ? 'unorm16' : 'unorm8',
    byteOrder: 'little-endian',
    rowStride: 4 * channelBytes,
    colorSpace: bitDepth === 32 ? 'scrgb' : 'srgb',
    transferFunction: bitDepth === 32 ? 'linear' : 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    originX: 0,
    originY: 0,
    pixels: new ArrayBuffer(4 * channelBytes),
  }
}

function load(
  bitDepth: 8 | 16 | 32,
  tile: ImageEditorV3SourceTile,
) {
  return loadImageEditorV3SourceRegion(
    RESOURCE,
    { x: 0, y: 0, width: 1, height: 1 },
    { width: 1, height: 1 },
    bitDepth,
    bitDepth === 32 ? 'rec2020' : 'srgb',
    bitDepth === 32 ? 'pq' : 'srgb',
    bitDepth === 32 ? 250 : 203,
    new AbortController().signal,
    {
      readSourceTile: async (request: ImageEditorV3ExportSourceTileRequest) => {
        expect(request.bitDepth).toBe(bitDepth)
        return tile
      },
    },
  )
}

describe('图片编辑 V3 导出源瓦片边界', () => {
  it.each([8, 16, 32] as const)('只接受与 %s-bit 请求完整匹配的紧密像素契约', async (bitDepth) => {
    await expect(load(bitDepth, sourceTile(bitDepth))).resolves.toMatchObject({
      width: 1,
      height: 1,
      storage: 'rgba-float32',
      colorDomain: 'linear-light',
      referenceWhiteNits: bitDepth === 32 ? 250 : 203,
    })
  })

  it.each([
    { name: 'sRGB 冒充 scRGB', patch: { colorSpace: 'srgb' } },
    { name: 'uint 冒充 float', patch: { sampleFormat: 'uint' } },
    { name: 'unorm 冒充 scene-linear', patch: { numericRange: 'unorm16' } },
    { name: 'sRGB 传递冒充 linear', patch: { transferFunction: 'srgb' } },
    { name: '错误字节序', patch: { byteOrder: 'big-endian' } },
    { name: '未应用方向', patch: { orientationApplied: false } },
    { name: '非紧密 rowStride', patch: { rowStride: 20, pixels: new ArrayBuffer(20) } },
    { name: '带多余 backing bytes', patch: { pixels: new ArrayBuffer(20) } },
  ])('在合成前拒绝 32-bit HDR 的$name', async ({ patch }) => {
    const corrupted = { ...sourceTile(32), ...patch } as ImageEditorV3SourceTile
    await expect(load(32, corrupted)).rejects.toThrow('不兼容的像素契约')
  })

  it.each([
    { sampleFormat: 'float' },
    { numericRange: 'scene-linear' },
    { colorSpace: 'scrgb' },
    { transferFunction: 'linear' },
  ])('拒绝 16-bit SDR 返回 float/scRGB 契约：%o', async (patch) => {
    const corrupted = { ...sourceTile(16), ...patch } as ImageEditorV3SourceTile
    await expect(load(16, corrupted)).rejects.toThrow('不兼容的像素契约')
  })
})
