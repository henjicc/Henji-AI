import type { Gpu, Texture } from 'vgpu'

import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

const GPU_TILE_ATLAS_MAX_EXTENT_V3 = 514
const GPU_TILE_ATLAS_PAGE_LAYERS_V3 = 16

type AtlasFormatV3 = 'rgba8unorm' | 'rgba16float'

interface AtlasPageV3 {
  readonly texture: Texture
  readonly format: AtlasFormatV3
  readonly bytes: number
  readonly layers: number
  readonly freeLayers: number[]
  liveAllocations: number
}

export interface ImageEditorGpuTileAtlasAllocationV3 {
  readonly key: ImageEditorGpuSceneTileKeyV3
  readonly texture: Texture
  readonly textureView: ReturnType<Texture['createView']>
  readonly layerTextureView: ReturnType<Texture['createView']>
  readonly atlasLayer: number
  readonly format: AtlasFormatV3
  readonly estimatedGpuBytes: number
  readonly tile: Pick<ImageEditorV3SourceTile,
  'originX' | 'originY' | 'width' | 'height' | 'transferFunction' | 'colorSpace'>
  destroy(): void
}

export interface ImageEditorGpuTileAtlasOptionsV3 {
  memoryBudgetBytes: number
  maxTextureDimension2D?: number
  maxTextureArrayLayers?: number
}

export class ImageEditorGpuTileAtlasBudgetErrorV3 extends Error {}

/**
 * 有界的 2D-array atlas。每个 array layer 是一个带 1px halo 的 512 瓦片槽；
 * 不将 8192² 资源物化为单纹理，局部 writeTexture 只更新实际到达的槽。
 */
export class ImageEditorGpuTileAtlasV3 {
  private readonly pages: AtlasPageV3[] = []
  private memoryBudgetBytes: number
  private readonly maxArrayLayers: number
  private allocatedBytes = 0
  private disposed = false

  constructor(private readonly gpu: Gpu, options: ImageEditorGpuTileAtlasOptionsV3) {
    this.memoryBudgetBytes = positiveInteger(options.memoryBudgetBytes, 'GPU atlas 预算')
    const maxDimension = positiveInteger(
      options.maxTextureDimension2D ?? gpu.gpu.limits.maxTextureDimension2D,
      'maxTextureDimension2D',
    )
    this.maxArrayLayers = positiveInteger(
      options.maxTextureArrayLayers ?? gpu.gpu.limits.maxTextureArrayLayers,
      'maxTextureArrayLayers',
    )
    if (maxDimension < GPU_TILE_ATLAS_MAX_EXTENT_V3) {
      throw new Error(`WebGPU maxTextureDimension2D ${maxDimension} 不足以容纳 512 瓦片与 halo`)
    }
  }

  estimateTileBytes(tile: ImageEditorV3SourceTile): number {
    return GPU_TILE_ATLAS_MAX_EXTENT_V3 * GPU_TILE_ATLAS_MAX_EXTENT_V3
      * bytesPerTexel(atlasFormat(tile))
  }

  setMemoryBudgetBytes(memoryBudgetBytes: number): void {
    this.memoryBudgetBytes = nonNegativeInteger(memoryBudgetBytes, 'GPU atlas 预算')
  }

  upload(
    key: ImageEditorGpuSceneTileKeyV3,
    tile: ImageEditorV3SourceTile,
  ): ImageEditorGpuTileAtlasAllocationV3 {
    this.assertUsable()
    assertTileExtent(tile)
    const format = atlasFormat(tile)
    const page = this.pageWithSpace(format) ?? this.allocatePage(format)
    const atlasLayer = page.freeLayers.pop()
    if (atlasLayer === undefined) throw new Error('GPU atlas 空闲槽计数不一致')
    const upload = uploadPixels(tile, format)
    try {
      this.gpu.gpu.queue.writeTexture(
        { texture: page.texture.gpu, origin: { x: 0, y: 0, z: atlasLayer } },
        upload.pixels,
        { bytesPerRow: upload.bytesPerRow, rowsPerImage: tile.height },
        { width: tile.width, height: tile.height, depthOrArrayLayers: 1 },
      )
    } catch (error) {
      page.freeLayers.push(atlasLayer)
      this.destroyEmptyPage(page)
      throw error
    }
    page.liveAllocations += 1
    let destroyed = false
    return {
      key: { ...key },
      texture: page.texture,
      textureView: page.texture.createView({ dimension: '2d-array' }),
      layerTextureView: page.texture.createView({
        dimension: '2d',
        baseArrayLayer: atlasLayer,
        arrayLayerCount: 1,
      }),
      atlasLayer,
      format,
      estimatedGpuBytes: this.estimateTileBytes(tile),
      tile: {
        originX: tile.originX,
        originY: tile.originY,
        width: tile.width,
        height: tile.height,
        transferFunction: tile.transferFunction,
        colorSpace: tile.colorSpace,
      },
      destroy: () => {
        if (destroyed) return
        destroyed = true
        page.freeLayers.push(atlasLayer)
        page.liveAllocations -= 1
        this.destroyEmptyPage(page)
      },
    }
  }

  snapshot(): { pages: number; allocations: number; allocatedBytes: number; budgetBytes: number } {
    return {
      pages: this.pages.length,
      allocations: this.pages.reduce((total, page) => total + page.liveAllocations, 0),
      allocatedBytes: this.allocatedBytes,
      budgetBytes: this.memoryBudgetBytes,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const page of this.pages) page.texture.destroy()
    this.pages.length = 0
    this.allocatedBytes = 0
  }

  private pageWithSpace(format: AtlasFormatV3): AtlasPageV3 | null {
    return this.pages.find((page) => page.format === format && page.freeLayers.length > 0) ?? null
  }

  private allocatePage(format: AtlasFormatV3): AtlasPageV3 {
    const slotBytes = GPU_TILE_ATLAS_MAX_EXTENT_V3 * GPU_TILE_ATLAS_MAX_EXTENT_V3
      * bytesPerTexel(format)
    const availableLayers = Math.floor((this.memoryBudgetBytes - this.allocatedBytes) / slotBytes)
    const layers = Math.min(GPU_TILE_ATLAS_PAGE_LAYERS_V3, this.maxArrayLayers, availableLayers)
    if (layers < 1) throw new ImageEditorGpuTileAtlasBudgetErrorV3('GPU atlas 超出会话显存预算')
    const texture = this.gpu.device.createTexture({
      size: [GPU_TILE_ATLAS_MAX_EXTENT_V3, GPU_TILE_ATLAS_MAX_EXTENT_V3, layers],
      format,
      usage: ['copy_dst', 'texture_binding'],
      label: `image-editor-gpu-tile-atlas:${format}:${this.pages.length}`,
    })
    const page = {
      texture,
      format,
      layers,
      bytes: slotBytes * layers,
      freeLayers: Array.from({ length: layers }, (_, index) => layers - index - 1),
      liveAllocations: 0,
    }
    this.pages.push(page)
    this.allocatedBytes += page.bytes
    return page
  }

  private destroyEmptyPage(page: AtlasPageV3): void {
    if (page.liveAllocations !== 0) return
    const index = this.pages.indexOf(page)
    if (index < 0) return
    this.pages.splice(index, 1)
    this.allocatedBytes -= page.bytes
    page.texture.destroy()
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('GPU atlas 已销毁')
  }
}

function atlasFormat(tile: ImageEditorV3SourceTile): AtlasFormatV3 {
  if (tile.bitDepth === 8 && tile.sampleFormat === 'uint' && tile.numericRange === 'unorm8') {
    return 'rgba8unorm'
  }
  if (tile.bitDepth === 16 && tile.sampleFormat === 'uint' && tile.numericRange === 'unorm16') {
    return 'rgba16float'
  }
  if (tile.bitDepth === 32 && tile.sampleFormat === 'float' && tile.numericRange === 'scene-linear') {
    return 'rgba16float'
  }
  throw new Error('GPU atlas 不支持该源瓦片格式')
}

function uploadPixels(
  tile: ImageEditorV3SourceTile,
  format: AtlasFormatV3,
): { pixels: ArrayBuffer; bytesPerRow: number } {
  if (format === 'rgba8unorm') return { pixels: tile.pixels, bytesPerRow: tile.rowStride }
  const source = new DataView(tile.pixels)
  const output = new Uint16Array(tile.width * tile.height * 4)
  const sourceChannelBytes = tile.bitDepth === 16 ? 2 : 4
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const sourceOffset = y * tile.rowStride + x * 4 * sourceChannelBytes
      const targetOffset = (y * tile.width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const value = tile.bitDepth === 16
          ? source.getUint16(sourceOffset + channel * 2, true) / 65_535
          : source.getFloat32(sourceOffset + channel * 4, true)
        if (!Number.isFinite(value)) throw new Error('GPU atlas 源瓦片包含非有限样本')
        output[targetOffset + channel] = float32ToFloat16(value)
      }
    }
  }
  return { pixels: output.buffer, bytesPerRow: tile.width * 8 }
}

function assertTileExtent(tile: ImageEditorV3SourceTile): void {
  if (tile.width < 1 || tile.height < 1
    || tile.width > GPU_TILE_ATLAS_MAX_EXTENT_V3
    || tile.height > GPU_TILE_ATLAS_MAX_EXTENT_V3) {
    throw new Error(`GPU atlas 瓦片不得超过 ${GPU_TILE_ATLAS_MAX_EXTENT_V3}×${GPU_TILE_ATLAS_MAX_EXTENT_V3}`)
  }
  const channelBytes = tile.bitDepth / 8
  if (tile.rowStride < tile.width * 4 * channelBytes
    || tile.pixels.byteLength < tile.rowStride * tile.height) {
    throw new Error('GPU atlas 源瓦片像素缓冲区不完整')
  }
}

function bytesPerTexel(format: AtlasFormatV3): number {
  return format === 'rgba8unorm' ? 4 : 8
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`)
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} 必须是非负整数`)
  return value
}

/** IEEE-754 round-to-nearest-even f32 → binary16。 */
export function float32ToFloat16(value: number): number {
  const scratch = new Float32Array(1)
  const bits = new Uint32Array(scratch.buffer)
  scratch[0] = value
  const word = bits[0]
  const sign = (word >>> 16) & 0x8000
  const exponent = (word >>> 23) & 0xff
  const mantissa = word & 0x7fffff
  if (exponent === 0xff) return sign | (mantissa === 0 ? 0x7c00 : 0x7e00)
  const halfExponent = exponent - 127 + 15
  if (halfExponent >= 0x1f) return sign | 0x7c00
  if (halfExponent <= 0) {
    if (halfExponent < -10) return sign
    const shifted = (mantissa | 0x800000) >>> (1 - halfExponent)
    return sign | ((shifted + 0x0fff + ((shifted >>> 13) & 1)) >>> 13)
  }
  const rounded = mantissa + 0x0fff + ((mantissa >>> 13) & 1)
  if (rounded & 0x800000) {
    const nextExponent = halfExponent + 1
    return sign | (nextExponent >= 0x1f ? 0x7c00 : nextExponent << 10)
  }
  return sign | (halfExponent << 10) | (rounded >>> 13)
}
