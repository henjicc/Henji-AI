import { gaussianParametersFromNodeV3 } from '@/core/imageEdit/v3/builtInRenderNodes'
import { resolveImageGaussianPlan } from '@/core/imageEdit/v3/effects/gaussianBlur'
import {
  createBuiltInImageEditRenderNodeRegistry,
  mapImageEditOutputPixelToSourceV3,
  resolveImageEditOutputGeometryV3,
  resolveImageEditOutputSourceRectV3,
  type ImageEditDocumentV3,
  type ImageEditRect,
  type ImageEditRenderPlan,
  type ImageEditOutputGeometryV3,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3RasterExportDescription } from '@/platform/contracts/imageEditorV3'
import {
  ImageEditorV3ExportCapabilityError,
  type ImageEditorV3ExportRenderRegion,
} from './contracts'

const registry = createBuiltInImageEditRenderNodeRegistry()

export type ImageEditorV3ExportGeometry = ImageEditOutputGeometryV3

export interface ImageEditorV3ExportNeighborhood {
  halo: number
  alignment: number
}

export function resolveImageEditorV3ExportGeometry(
  document: ImageEditDocumentV3,
  description?: Pick<ImageEditorV3RasterExportDescription, 'width' | 'height'>,
): ImageEditorV3ExportGeometry {
  const geometry = resolveImageEditOutputGeometryV3(document.geometry)
  if (description && (
    description.width !== geometry.outputWidth
    || description.height !== geometry.outputHeight
  )) {
    throw new ImageEditorV3ExportCapabilityError(
      'OUTPUT_GEOMETRY_MISMATCH',
      `导出尺寸 ${description.width}×${description.height} 与文档输出 ${geometry.outputWidth}×${geometry.outputHeight} 不一致`,
    )
  }
  return geometry
}

export function mapImageEditorV3OutputPixelToSource(
  outputX: number,
  outputY: number,
  geometry: ImageEditorV3ExportGeometry,
): readonly [number, number] {
  return mapImageEditOutputPixelToSourceV3(outputX, outputY, geometry)
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
    if (node.definitionId === 'effect.gaussian_blur') {
      const gaussian = resolveImageGaussianPlan(gaussianParametersFromNodeV3(node.parameters), {
        referenceSize: { width: plan.geometry.width, height: plan.geometry.height },
        outputSize: { width: plan.geometry.width, height: plan.geometry.height }, quality: 'final',
      })
      alignment = Math.max(alignment, ...gaussian.alignment)
    }
  }
  return { halo, alignment }
}

export function resolveImageEditorV3SourceRegion(
  outputRect: ImageEditRect,
  geometry: ImageEditorV3ExportGeometry,
  neighborhood: ImageEditorV3ExportNeighborhood,
): ImageEditorV3ExportRenderRegion {
  return resolveImageEditOutputSourceRectV3(
    outputRect,
    geometry,
    neighborhood.halo,
    neighborhood.alignment,
  )
}
