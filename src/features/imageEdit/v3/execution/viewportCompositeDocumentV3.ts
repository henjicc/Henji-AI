import {
  IMAGE_EDIT_IDENTITY_TRANSFORM_V3,
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  type ImageEditDocumentV3,
  type ImageEditRenderPlan,
} from '@/core/imageEdit/v3'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type {
  ImageEditorV3ResourceDescriptor,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'
import {
  collectImageEditorPreviewResourceRequestsV3,
  type ImageEditorPreviewBrushResourceRequestV3,
} from './previewDocumentV3'
import { createImageEditorSparseMaskPlanV3 } from './sparseMaskResourcesV3'
import type { ImageEditorViewportTilePlanV3 } from './viewportTilePlannerV3'

const registry = createBuiltInImageEditRenderNodeRegistry()
const RESOURCE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/
const REGION_SAFE_NODES = new Set([
  'source.raster',
  'vector.annotation',
  'effect.blur-v1',
  'effect.gaussian-blur',
  'adjustment.exposure',
  'adjustment.curves',
  'adjustment.temperature-tint',
  'adjustment.hsl',
  'composite.layer',
  'group.isolated',
])

export class ImageEditorViewportCompositeUnsupportedErrorV3 extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageEditorViewportCompositeUnsupportedErrorV3'
  }
}

export interface PreparedImageEditorViewportCompositeV3 {
  plan: ImageEditRenderPlan
  resourceRefs: readonly ImageEditorV3ResourceRef[]
  primaryResourceRef: ImageEditorV3ResourceRef
  haloDocumentPixels: number
  brushRequests: readonly ImageEditorPreviewBrushResourceRequestV3[]
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentityTransform(value: unknown): boolean {
  return Array.isArray(value)
    && value.length === IMAGE_EDIT_IDENTITY_TRANSFORM_V3.length
    && value.every((entry, index) => entry === IMAGE_EDIT_IDENTITY_TRANSFORM_V3[index])
}

function nodeResourceRefs(plan: ImageEditRenderPlan): ImageEditorV3ResourceRef[] {
  const result: ImageEditorV3ResourceRef[] = []
  const seen = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value !== 'string' || !RESOURCE_REF_PATTERN.test(value) || seen.has(value)) return
    seen.add(value)
    result.push(value as ImageEditorV3ResourceRef)
  }
  for (const node of plan.nodes) {
    if (node.definitionId === 'source.raster') {
      const source = isRecord(node.parameters.source) ? node.parameters.source : null
      if (source?.kind === 'resource') add(source.resourceId)
    }
    if (node.mask && 'resourceId' in node.mask) add(node.mask.resourceId)
  }
  return result
}

function activeBrushResourceIds(plan: ImageEditRenderPlan): ReadonlySet<string> {
  const result = new Set<string>()
  for (const node of plan.nodes) {
    if (node.definitionId !== 'source.raster' || !isRecord(node.parameters.tiles)) continue
    for (const resourceId of Object.values(node.parameters.tiles)) {
      if (typeof resourceId === 'string') result.add(resourceId)
    }
  }
  return result
}

function resolveHalo(plan: ImageEditRenderPlan): number {
  let halo = 0
  for (const node of plan.nodes) {
    const definition = registry.get(node.definitionId)
    const local = definition?.localHalo?.(node.parameters, 0) ?? 0
    if (local > 0) halo += Math.ceil(local)
  }
  return halo
}

/** 只接受能够对任意含 halo 小区域作视觉等价求值的文档。 */
export function prepareImageEditorViewportCompositeV3(
  document: ImageEditDocumentV3,
  quality: ImageEditRenderQuality,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
): PreparedImageEditorViewportCompositeV3 {
  if (
    document.geometry.crop
    || document.geometry.orientation.rotate !== 0
    || document.geometry.orientation.mirrored
  ) {
    throw new ImageEditorViewportCompositeUnsupportedErrorV3(
      '当前输出方向或裁剪仍由全局受管预览显示',
    )
  }
  const plan = compileImageEditRenderPlanV3(document, registry, quality)
  if (plan.diagnostics.length > 0) {
    throw new ImageEditorViewportCompositeUnsupportedErrorV3('当前文档包含不可分块渲染的图层')
  }
  for (const node of plan.nodes) {
    if (!REGION_SAFE_NODES.has(node.definitionId) || node.category === 'global-analysis') {
      throw new ImageEditorViewportCompositeUnsupportedErrorV3(
        `效果 ${node.definitionId} 需要全局受管预览`,
      )
    }
    if (node.definitionId === 'composite.layer' && !isIdentityTransform(node.parameters.transform)) {
      throw new ImageEditorViewportCompositeUnsupportedErrorV3('图层仿射变换仍由全局受管预览显示')
    }
    if (
      node.definitionId === 'vector.annotation'
      && Array.isArray(node.parameters.annotations)
      && node.parameters.annotations.some((item) => isRecord(item) && item.type === 'mosaic')
    ) {
      throw new ImageEditorViewportCompositeUnsupportedErrorV3('旧马赛克标注仍由全局受管预览显示')
    }
  }
  const resourceRefs = nodeResourceRefs(plan)
  if (resourceRefs.length === 0) {
    throw new ImageEditorViewportCompositeUnsupportedErrorV3('当前文档没有可规划的图片金字塔资源')
  }
  const activeBrushes = activeBrushResourceIds(plan)
  const sparseMasks = createImageEditorSparseMaskPlanV3(
    plan,
    document.geometry,
    resourceDescriptors,
  )
  const activeMaskTiles = new Set<string>()
  for (const mask of sparseMasks.byMaskId.values()) {
    for (const tile of mask.tiles.values()) activeMaskTiles.add(tile.resourceId)
  }
  const brushRequests = collectImageEditorPreviewResourceRequestsV3(
    document,
    1,
    resourceDescriptors,
  ).filter((request): request is ImageEditorPreviewBrushResourceRequestV3 => (
    request.kind === 'brush-tile'
    && (
      (request.storage === 'rgba-float32' && activeBrushes.has(request.resourceId))
      || (request.storage === 'mask-float32' && activeMaskTiles.has(request.resourceId))
    )
  ))
  return {
    plan,
    resourceRefs,
    primaryResourceRef: resourceRefs[0],
    haloDocumentPixels: resolveHalo(plan),
    brushRequests,
  }
}

function intersectsRequestedRegion(
  request: ImageEditorPreviewBrushResourceRequestV3,
  plan: ImageEditorViewportTilePlanV3,
): boolean {
  const [, xValue, yValue] = request.tileKey.split('/')
  const tileX = Number(xValue)
  const tileY = Number(yValue)
  const scale = 2 ** plan.mip
  const left = tileX * 512 / scale
  const top = tileY * 512 / scale
  const right = (tileX * 512 + request.width) / scale
  const bottom = (tileY * 512 + request.height) / scale
  return plan.tiles.some((tile) => (
    left < tile.originX + tile.width
    && right > tile.originX
    && top < tile.originY + tile.height
    && bottom > tile.originY
  ))
}

export function collectImageEditorViewportBrushRequestsV3(
  prepared: PreparedImageEditorViewportCompositeV3,
  plan: ImageEditorViewportTilePlanV3,
): ImageEditorPreviewBrushResourceRequestV3[] {
  return prepared.brushRequests.filter((request) => intersectsRequestedRegion(request, plan))
}
