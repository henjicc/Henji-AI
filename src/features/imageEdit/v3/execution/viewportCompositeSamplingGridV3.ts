import {
  IMAGE_EDIT_IDENTITY_TRANSFORM_V3,
  isImageEditSparseMaskReferenceV3,
  mipSize,
  type ImageEditCpuSamplingGridV3,
  type ImageEditCpuSamplingTargetV3,
  type ImageEditRenderPlan,
  type ImageEditRenderPlanNode,
  type ImageEditSize,
} from '@/core/imageEdit/v3'
import { resolveImageEditRasterSourceExtentV3 } from '@/core/imageEdit/v3/execution/rasterSourceGeometry'

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

function rasterResourceId(node: ImageEditRenderPlanNode): string | null {
  if (node.definitionId !== 'source.raster') return null
  const source = record(node.parameters.source)
  return source?.kind === 'resource' && typeof source.resourceId === 'string'
    ? source.resourceId
    : null
}

function samplingGrid(
  size: ImageEditSize,
  actualMip: number,
  outputMip: number,
): ImageEditCpuSamplingGridV3 {
  const scale = 2 ** (actualMip - outputMip)
  return {
    size: mipSize(size, actualMip),
    toEvaluation: scale === 1
      ? IMAGE_EDIT_IDENTITY_TRANSFORM_V3
      : [scale, 0, 0, scale, 0, 0],
  }
}

/**
 * 把 viewport 本帧真实读取的 source/mask mip 交给唯一 CPU 区域求值器。
 * 图层权威 transform 不在这里改写；core 只在合成边界合并一次 sampling grid。
 */
export function createImageEditorViewportSamplingGridResolverV3(
  plan: ImageEditRenderPlan,
  resourceSizes: ReadonlyMap<string, ImageEditSize>,
  sourceMipLevels: ReadonlyMap<string, number>,
  documentSize: ImageEditSize,
  outputMip: number,
): (target: ImageEditCpuSamplingTargetV3) => ImageEditCpuSamplingGridV3 | undefined {
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]))
  const fallback = samplingGrid(documentSize, outputMip, outputMip)
  const contentGrid = (
    node: ImageEditRenderPlanNode,
    seen: Set<string>,
  ): ImageEditCpuSamplingGridV3 => {
    if (seen.has(node.id)) return fallback
    seen.add(node.id)
    if (node.definitionId === 'source.raster') {
      const resourceId = rasterResourceId(node)
      const sourceSize = resourceId ? resourceSizes.get(resourceId) : null
      if (resourceId && !sourceSize) throw new Error('视口采样网格缺少图片源几何')
      const actualMip = resourceId
        ? sourceMipLevels.get(resourceId)
        : outputMip
      if (resourceId && actualMip === undefined) {
        throw new Error('视口采样网格缺少图片源 mip')
      }
      const sparseKeys = record(node.parameters.tiles)
        ? Object.keys(node.parameters.tiles as Readonly<Record<string, unknown>>)
        : []
      const extent = resolveImageEditRasterSourceExtentV3(
        sourceSize ?? null,
        documentSize,
        sparseKeys,
      )
      return samplingGrid(extent, actualMip ?? outputMip, outputMip)
    }
    if (node.definitionId === 'composite.layer'
      || node.definitionId === 'group.isolated'
      || node.definitionId === 'vector.annotation'
      || node.inputNodeIds.length !== 1) return fallback
    const input = nodes.get(node.inputNodeIds[0] ?? '')
    return input ? contentGrid(input, seen) : fallback
  }
  return (target) => {
    if (target.kind === 'content') return contentGrid(target.node, new Set())
    if (isImageEditSparseMaskReferenceV3(target.reference)) return fallback
    const resourceId = target.reference.resourceId
    const sourceSize = resourceSizes.get(resourceId)
    const actualMip = sourceMipLevels.get(resourceId)
    if (!sourceSize || actualMip === undefined) {
      throw new Error('视口采样网格缺少蒙版资源几何或 mip')
    }
    return samplingGrid(sourceSize, actualMip, outputMip)
  }
}
