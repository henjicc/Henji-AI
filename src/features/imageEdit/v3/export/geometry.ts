import {
  createBuiltInImageEditRenderNodeRegistry,
  resolveGaussianBlurV2Geometry,
  type ImageEditDocumentV3,
  type ImageEditRect,
  type ImageEditRenderPlan,
  type ImageEditRotationV3,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3RasterExportDescription } from '@/platform/contracts/imageEditorV3'
import {
  ImageEditorV3ExportCapabilityError,
  type ImageEditorV3ExportRenderRegion,
} from './contracts'

const registry = createBuiltInImageEditRenderNodeRegistry()

export interface ImageEditorV3ExportGeometry {
  sourceWidth: number
  sourceHeight: number
  orientedWidth: number
  orientedHeight: number
  outputWidth: number
  outputHeight: number
  cropX: number
  cropY: number
  rotate: ImageEditRotationV3
  mirrored: boolean
}

export interface ImageEditorV3ExportNeighborhood {
  halo: number
  alignment: number
}

function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} 必须是整数`)
  return value
}

export function resolveImageEditorV3ExportGeometry(
  document: ImageEditDocumentV3,
  description?: Pick<ImageEditorV3RasterExportDescription, 'width' | 'height'>,
): ImageEditorV3ExportGeometry {
  const sourceWidth = safeInteger(document.geometry.width, '文档宽度')
  const sourceHeight = safeInteger(document.geometry.height, '文档高度')
  const { rotate, mirrored } = document.geometry.orientation
  const swapsAxes = rotate === 90 || rotate === 270
  const orientedWidth = swapsAxes ? sourceHeight : sourceWidth
  const orientedHeight = swapsAxes ? sourceWidth : sourceHeight
  const crop = document.geometry.crop
  const cropX = crop ? safeInteger(crop.x, '裁剪横坐标') : 0
  const cropY = crop ? safeInteger(crop.y, '裁剪纵坐标') : 0
  const outputWidth = crop ? safeInteger(crop.width, '裁剪宽度') : orientedWidth
  const outputHeight = crop ? safeInteger(crop.height, '裁剪高度') : orientedHeight
  if (
    sourceWidth < 1
    || sourceHeight < 1
    || cropX < 0
    || cropY < 0
    || outputWidth < 1
    || outputHeight < 1
    || cropX + outputWidth > orientedWidth
    || cropY + outputHeight > orientedHeight
  ) throw new Error('图片编辑输出几何超出文档范围')
  if (description && (description.width !== outputWidth || description.height !== outputHeight)) {
    throw new ImageEditorV3ExportCapabilityError(
      'OUTPUT_GEOMETRY_MISMATCH',
      `导出尺寸 ${description.width}×${description.height} 与文档输出 ${outputWidth}×${outputHeight} 不一致`,
    )
  }
  return {
    sourceWidth,
    sourceHeight,
    orientedWidth,
    orientedHeight,
    outputWidth,
    outputHeight,
    cropX,
    cropY,
    rotate,
    mirrored,
  }
}

export function mapImageEditorV3OutputPixelToSource(
  outputX: number,
  outputY: number,
  geometry: ImageEditorV3ExportGeometry,
): readonly [number, number] {
  const orientedX = outputX + geometry.cropX
  const orientedY = outputY + geometry.cropY
  let mirroredX: number
  let sourceY: number
  if (geometry.rotate === 90) {
    mirroredX = orientedY
    sourceY = geometry.sourceHeight - 1 - orientedX
  } else if (geometry.rotate === 180) {
    mirroredX = geometry.sourceWidth - 1 - orientedX
    sourceY = geometry.sourceHeight - 1 - orientedY
  } else if (geometry.rotate === 270) {
    mirroredX = geometry.sourceWidth - 1 - orientedY
    sourceY = orientedX
  } else {
    mirroredX = orientedX
    sourceY = orientedY
  }
  const sourceX = geometry.mirrored
    ? geometry.sourceWidth - 1 - mirroredX
    : mirroredX
  return [sourceX, sourceY]
}

export function resolveImageEditorV3ExportNeighborhood(
  plan: ImageEditRenderPlan,
): ImageEditorV3ExportNeighborhood {
  let halo = 0
  let alignment = 1
  for (const node of plan.nodes) {
    const definition = registry.get(node.definitionId)
    const localHalo = definition?.localHalo?.(node.parameters, 0) ?? 0
    if (localHalo > 0) halo += Math.ceil(localHalo)
    if (node.definitionId === 'effect.gaussian-blur') {
      const radiusValue = node.parameters.radius
      const radius = typeof radiusValue === 'number' && Number.isFinite(radiusValue)
        ? Math.max(0, radiusValue)
        : 0
      const geometry = resolveGaussianBlurV2Geometry({ radius, mip: 0 })
      alignment = Math.max(alignment, 2 ** geometry.pyramidLevel)
    }
  }
  return { halo, alignment }
}

function alignDown(value: number, alignment: number): number {
  return Math.floor(value / alignment) * alignment
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

export function resolveImageEditorV3SourceRegion(
  outputRect: ImageEditRect,
  geometry: ImageEditorV3ExportGeometry,
  neighborhood: ImageEditorV3ExportNeighborhood,
): ImageEditorV3ExportRenderRegion {
  const right = outputRect.x + outputRect.width - 1
  const bottom = outputRect.y + outputRect.height - 1
  const points = [
    mapImageEditorV3OutputPixelToSource(outputRect.x, outputRect.y, geometry),
    mapImageEditorV3OutputPixelToSource(right, outputRect.y, geometry),
    mapImageEditorV3OutputPixelToSource(outputRect.x, bottom, geometry),
    mapImageEditorV3OutputPixelToSource(right, bottom, geometry),
  ]
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const left = Math.max(0, alignDown(Math.min(...xs) - neighborhood.halo, neighborhood.alignment))
  const top = Math.max(0, alignDown(Math.min(...ys) - neighborhood.halo, neighborhood.alignment))
  const sourceRight = Math.min(
    geometry.sourceWidth,
    alignUp(Math.max(...xs) + 1 + neighborhood.halo, neighborhood.alignment),
  )
  const sourceBottom = Math.min(
    geometry.sourceHeight,
    alignUp(Math.max(...ys) + 1 + neighborhood.halo, neighborhood.alignment),
  )
  return { x: left, y: top, width: sourceRight - left, height: sourceBottom - top }
}
