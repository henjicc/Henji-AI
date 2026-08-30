import {
  convertFloat32TileColorDomainV3,
  convertFloat32TileWorkingSpaceV3,
  createFloat32PremultipliedRgbaTile,
  encodeTransferFunctionV3,
  type Float32PremultipliedRgbaTile,
  type ImageEditRect,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3RenderedExportTile } from '@/commands/imageEditorV3Export'
import type { ImageEditorV3RasterExportDescription } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorV3ExportRenderRegion } from './contracts'
import {
  mapImageEditorV3OutputPixelToSource,
  type ImageEditorV3ExportGeometry,
} from './geometry'

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function projectImageEditorV3RenderedRegionToOutput(
  rendered: Float32PremultipliedRgbaTile,
  region: ImageEditorV3ExportRenderRegion,
  outputRect: ImageEditRect,
  geometry: ImageEditorV3ExportGeometry,
): Float32PremultipliedRgbaTile {
  if (rendered.width !== region.width || rendered.height !== region.height) {
    throw new Error('渲染结果与请求的源区域尺寸不一致')
  }
  const data = new Float32Array(outputRect.width * outputRect.height * 4)
  for (let y = 0; y < outputRect.height; y += 1) {
    for (let x = 0; x < outputRect.width; x += 1) {
      const [sourceX, sourceY] = mapImageEditorV3OutputPixelToSource(
        outputRect.x + x,
        outputRect.y + y,
        geometry,
      )
      const localX = sourceX - region.x
      const localY = sourceY - region.y
      if (localX < 0 || localY < 0 || localX >= region.width || localY >= region.height) {
        throw new Error('输出像素映射超出当前分块渲染区域')
      }
      const sourceOffset = (localY * rendered.width + localX) * 4
      const targetOffset = (y * outputRect.width + x) * 4
      data.set(rendered.data.subarray(sourceOffset, sourceOffset + 4), targetOffset)
    }
  }
  return createFloat32PremultipliedRgbaTile(
    outputRect.width,
    outputRect.height,
    rendered.colorDomain,
    data,
    rendered.workingSpace,
    rendered.transferFunction,
    rendered.referenceWhiteNits,
  )
}

function writeIntegerSample(
  output: Uint8Array,
  view: DataView,
  byteOffset: number,
  bitDepth: 8 | 16,
  value: number,
): void {
  if (bitDepth === 8) output[byteOffset] = Math.round(clamp01(value) * 255)
  else view.setUint16(byteOffset, Math.round(clamp01(value) * 65_535), true)
}

export function encodeImageEditorV3RenderedOutputTile(
  tile: Float32PremultipliedRgbaTile,
  outputRect: ImageEditRect,
  description: ImageEditorV3RasterExportDescription,
): ImageEditorV3RenderedExportTile {
  const linear = convertFloat32TileWorkingSpaceV3(
    convertFloat32TileColorDomainV3(tile, 'linear-light'),
    description.colorSpace,
  )
  const bytesPerChannel = description.bitDepth / 8
  const rowStride = tile.width * 4 * bytesPerChannel
  const output = new Uint8Array(rowStride * tile.height)
  const view = new DataView(output.buffer)
  for (let pixel = 0; pixel < tile.width * tile.height; pixel += 1) {
    const sourceOffset = pixel * 4
    const byteOffset = pixel * 4 * bytesPerChannel
    const alpha = clamp01(linear.data[sourceOffset + 3])
    for (let channel = 0; channel < 3; channel += 1) {
      const straight = alpha > 0 ? linear.data[sourceOffset + channel] / alpha : 0
      const encoded = encodeTransferFunctionV3(
        straight,
        description.transferFunction,
        linear.referenceWhiteNits,
      )
      const sample = description.alphaMode === 'premultiplied' ? encoded * alpha : encoded
      if (!Number.isFinite(sample)) throw new Error('导出颜色计算结果不是有限数')
      if (description.bitDepth === 32) view.setFloat32(byteOffset + channel * 4, sample, true)
      else writeIntegerSample(output, view, byteOffset + channel * bytesPerChannel, description.bitDepth, sample)
    }
    if (description.bitDepth === 32) view.setFloat32(byteOffset + 12, alpha, true)
    else writeIntegerSample(output, view, byteOffset + 3 * bytesPerChannel, description.bitDepth, alpha)
  }
  return {
    x: outputRect.x,
    y: outputRect.y,
    width: outputRect.width,
    height: outputRect.height,
    rowStride,
    pixels: output,
  }
}
