import {
  convertFloat32TileWorkingSpaceV3,
  createFloat32PremultipliedRgbaTile,
  decodeSrgbExtended,
  type Float32PremultipliedRgbaTile,
} from '@/core/imageEdit/v3'
import type { MarkItem } from '@/core/imageEdit/types'
import { drawMarkItems } from '@/features/imageMark/render/drawMarks'
import {
  ImageEditorV3ExportCapabilityError,
  type ImageEditorV3ExportAnnotationRasterizeRequest,
} from './contracts'

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('图片分块导出已取消')
  error.name = 'AbortError'
  throw error
}

function imageDataToLinearTile(imageData: ImageData): Float32PremultipliedRgbaTile {
  const data = new Float32Array(imageData.width * imageData.height * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = imageData.data[offset + 3] / 255
    data[offset] = decodeSrgbExtended(imageData.data[offset] / 255) * alpha
    data[offset + 1] = decodeSrgbExtended(imageData.data[offset + 1] / 255) * alpha
    data[offset + 2] = decodeSrgbExtended(imageData.data[offset + 2] / 255) * alpha
    data[offset + 3] = alpha
  }
  return createFloat32PremultipliedRgbaTile(
    imageData.width,
    imageData.height,
    'linear-light',
    data,
  )
}

/** 只建立当前含 halo 的小画布；标注仍按完整文档坐标求值。 */
export async function rasterizeImageEditorV3ExportAnnotations(
  request: ImageEditorV3ExportAnnotationRasterizeRequest,
): Promise<Float32PremultipliedRgbaTile> {
  throwIfAborted(request.signal)
  if (typeof OffscreenCanvas === 'undefined') {
    throw new ImageEditorV3ExportCapabilityError(
      'ANNOTATION_RASTERIZER_UNAVAILABLE',
      '当前渲染环境没有 OffscreenCanvas，无法保持可编辑标注的导出外观',
    )
  }
  const annotations = Array.isArray(request.node.parameters.annotations)
    ? request.node.parameters.annotations as MarkItem[]
    : []
  const canvas = new OffscreenCanvas(request.region.width, request.region.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new ImageEditorV3ExportCapabilityError(
      'ANNOTATION_RASTERIZER_UNAVAILABLE',
      '无法创建标注分块光栅化上下文',
    )
  }
  const scale = 2 ** (request.mip ?? 0)
  context.save()
  context.translate(-request.region.x, -request.region.y)
  context.scale(1 / scale, 1 / scale)
  drawMarkItems(
    context,
    annotations,
    request.document.geometry.width,
    request.document.geometry.height,
    { canvasKind: 'offscreen' },
  )
  context.restore()
  throwIfAborted(request.signal)
  const tile = imageDataToLinearTile(
    context.getImageData(0, 0, request.region.width, request.region.height),
  )
  const converted = convertFloat32TileWorkingSpaceV3(tile, request.document.color.workingSpace)
  return createFloat32PremultipliedRgbaTile(
    converted.width,
    converted.height,
    converted.colorDomain,
    new Float32Array(converted.data),
    converted.workingSpace,
    request.document.color.transferFunction,
    converted.referenceWhiteNits,
  )
}
