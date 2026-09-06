import {
  collectImageEditCpuRegionRequirementsV3,
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  createTileRegion,
  enumerateTilesForRect,
  imageEditOutputSizeV3,
  isImageEditSparseMaskReferenceV3,
  mipSize,
  resolveImageEditOutputGeometryV3,
  resolveImageEditOutputSourceRectAtMipV3,
  type ImageEditDocumentV3,
  type ImageEditRect,
  type ImageEditRenderPlan,
  type ImageEditOutputGeometryV3,
  type ImageEditSize,
} from '@/core/imageEdit/v3'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import { resolveImageEditRasterStorageSizeV3, imageEditRasterOverrideRectV3 } from '@/core/imageEdit/v3/execution/rasterSourceGeometry'
import { imageEditRasterBoundaryBasePointsV3 } from '@/core/imageEdit/v3/execution/rasterTileReplacement'
import type {
  ImageEditorV3ResourceDescriptor,
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3ResourceRef,
} from '@/platform/contracts/imageEditorV3'
import {
  collectImageEditorPreviewResourceRequestsV3,
  type ImageEditorPreviewBrushResourceRequestV3,
} from './previewDocumentV3'
import { scaleImageEditorPreviewEffectsV3 } from './previewEffectScalingV3'
import { createImageEditorSparseMaskPlanV3 } from './sparseMaskResourcesV3'
import {
  imageEditorViewportTileCacheKeyV3,
  type ImageEditorViewportTileCandidateV3,
  type ImageEditorViewportTilePlanV3,
  type ImageEditorViewportTileRequestV3,
} from './viewportTilePlannerV3'
import {
  resolveImageEditorViewportSourceMipV3,
} from './viewportTileSchedulingSupportV3'
import { createImageEditorViewportSamplingGridResolverV3 } from './viewportCompositeSamplingGridV3'

const registry = createBuiltInImageEditRenderNodeRegistry()
const RESOURCE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/

export class ImageEditorViewportCompositeUnsupportedErrorV3 extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageEditorViewportCompositeUnsupportedErrorV3'
  }
}

export interface PreparedImageEditorViewportCompositeV3 {
  document: ImageEditDocumentV3
  quality: ImageEditRenderQuality
  plan: ImageEditRenderPlan
  outputGeometry: ImageEditOutputGeometryV3
  resourceRefs: readonly ImageEditorV3ResourceRef[]
  primaryResourceRef: ImageEditorV3ResourceRef | null
  /** 局部 halo 由区域 RenderPlan 递归规划，不再绑在屏幕瓦片上。 */
  haloDocumentPixels: 0
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function rasterResourceId(node: ImageEditRenderPlan['nodes'][number]): ImageEditorV3ResourceRef | null {
  const source = isRecord(node.parameters.source) ? node.parameters.source : null
  return source?.kind === 'resource'
    && typeof source.resourceId === 'string'
    && RESOURCE_REF_PATTERN.test(source.resourceId)
    ? source.resourceId as ImageEditorV3ResourceRef
    : null
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

/** 只接受能够对任意有界区域作视觉等价求值的文档。 */
export function prepareImageEditorViewportCompositeV3(
  document: ImageEditDocumentV3,
  quality: ImageEditRenderQuality,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
): PreparedImageEditorViewportCompositeV3 {
  const plan = compileImageEditRenderPlanV3(document, registry, quality)
  if (plan.diagnostics.length > 0) {
    throw new ImageEditorViewportCompositeUnsupportedErrorV3('当前文档包含不可分块渲染的图层')
  }
  for (const node of plan.nodes) {
    if (!registry.get(node.definitionId)) {
      throw new ImageEditorViewportCompositeUnsupportedErrorV3(
        `效果 ${node.definitionId} 没有注册分块执行器`,
      )
    }
  }
  const resourceRefs = nodeResourceRefs(plan)
  return {
    document,
    quality,
    plan,
    outputGeometry: resolveImageEditOutputGeometryV3(document.geometry),
    resourceRefs,
    primaryResourceRef: resourceRefs[0] ?? null,
    haloDocumentPixels: 0,
    resourceDescriptors,
  }
}

function renderPlanForMip(
  prepared: PreparedImageEditorViewportCompositeV3,
  mip: number,
): ImageEditRenderPlan {
  return compileImageEditRenderPlanV3(
    scaleImageEditorPreviewEffectsV3(prepared.document, 1 / (2 ** mip)),
    registry,
    prepared.quality,
  )
}

function outputRegionsForCandidate(
  prepared: PreparedImageEditorViewportCompositeV3,
  candidate: ImageEditorViewportTileCandidateV3,
): ImageEditRect[] {
  return candidate.tiles.map(({ tileX, tileY }) => (
    resolveImageEditOutputSourceRectAtMipV3(
      createTileRegion(
        imageEditOutputSizeV3(prepared.document.geometry),
        { mip: candidate.mip, x: tileX, y: tileY },
        0,
      ).outputRect,
      prepared.outputGeometry,
      candidate.mip,
    )
  ))
}

function requirementsForCandidate(
  prepared: PreparedImageEditorViewportCompositeV3,
  candidate: ImageEditorViewportTileCandidateV3,
  resourceSizes: ReadonlyMap<string, ImageEditSize> = new Map(),
  sourceMips: ReadonlyMap<string, number> = new Map(),
): {
  plan: ImageEditRenderPlan
  rasterRegions: ReadonlyMap<string, readonly ImageEditRect[]>
  maskRegions: ReadonlyMap<string, readonly ImageEditRect[]>
} {
  const plan = renderPlanForMip(prepared, candidate.mip)
  return {
    plan,
    ...collectImageEditCpuRegionRequirementsV3(
      plan,
      outputRegionsForCandidate(prepared, candidate),
      {
        registry,
        size: mipSize(prepared.document.geometry, candidate.mip),
        scaleX: 1 / (2 ** candidate.mip),
        scaleY: 1 / (2 ** candidate.mip),
        resolveSamplingGrid: createImageEditorViewportSamplingGridResolverV3(
          plan,
          resourceSizes,
          sourceMips,
          prepared.document.geometry,
          candidate.mip,
        ),
      },
    ),
  }
}

function sourceRequest(
  resourceRef: ImageEditorV3ResourceRef,
  mip: number,
  tileX: number,
  tileY: number,
  bitDepth: 8 | 16 | 32,
  sourceSize: ImageEditSize,
): ImageEditorViewportTileRequestV3 {
  const region = createTileRegion(sourceSize, { mip, x: tileX, y: tileY }, 0)
  const estimatedBytes = region.sourceRect.width * region.sourceRect.height * 4 * (bitDepth / 8)
  if (!Number.isSafeInteger(estimatedBytes)) throw new Error('视口仿射源瓦片字节数超出安全范围')
  const request = {
    resourceRef,
    mip,
    tileX,
    tileY,
    halo: 0,
    bitDepth,
    width: region.sourceRect.width,
    height: region.sourceRect.height,
    originX: region.sourceRect.x,
    originY: region.sourceRect.y,
    estimatedBytes,
  }
  return { ...request, key: imageEditorViewportTileCacheKeyV3(request) }
}

/** 视口瓦片只读取逆变换后真正需要的 512 源瓦片。 */
export function createImageEditorViewportSourceTileRequestsV3(
  prepared: PreparedImageEditorViewportCompositeV3,
  candidate: ImageEditorViewportTileCandidateV3,
  bitDepth: 8 | 16 | 32,
  wholeSource = false,
  resourceSizes: ReadonlyMap<string, ImageEditSize> = new Map(),
  resourcePyramids: ReadonlyMap<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor> = new Map(),
): ImageEditorViewportTileRequestV3[] {
  const requests = new Map<string, ImageEditorViewportTileRequestV3>()
  const sourceMips = new Map(prepared.resourceRefs.map((resourceRef) => [
    resourceRef,
    resourcePyramids.has(resourceRef)
      ? resolveImageEditorViewportSourceMipV3(resourcePyramids.get(resourceRef)!, candidate.mip)
      : candidate.mip,
  ]))
  const addRegions = (
    resourceRef: ImageEditorV3ResourceRef,
    regions: readonly ImageEditRect[],
    coordinateMip = candidate.mip,
  ): void => {
    const sourceSize = resourceSizes.get(resourceRef) ?? prepared.document.geometry
    const sourceMip = sourceMips.get(resourceRef) ?? candidate.mip
    for (const region of regions) {
      if (coordinateMip !== sourceMip) {
        throw new Error('视口源读取区域与采样网格 mip 不一致')
      }
      for (const coordinate of enumerateTilesForRect(sourceSize, sourceMip, region)) {
        const request = sourceRequest(
          resourceRef,
          sourceMip,
          coordinate.x,
          coordinate.y,
          bitDepth,
          sourceSize,
        )
        requests.set(request.key, request)
      }
    }
  }
  if (wholeSource) {
    for (const resourceRef of prepared.resourceRefs) {
      const size = mipSize(
        resourceSizes.get(resourceRef) ?? prepared.document.geometry,
        sourceMips.get(resourceRef) ?? candidate.mip,
      )
      addRegions(resourceRef, [{ x: 0, y: 0, ...size }], sourceMips.get(resourceRef))
    }
  }
  const requirements = requirementsForCandidate(prepared, candidate, resourceSizes, sourceMips)
  for (const node of requirements.plan.nodes) {
    if (node.definitionId === 'source.raster') {
      const resourceRef = rasterResourceId(node)
      const regions = requirements.rasterRegions.get(node.id)
      const rasterMip = resourceRef
        ? sourceMips.get(resourceRef) ?? candidate.mip
        : candidate.mip
      if (resourceRef && regions) addRegions(
        resourceRef,
        regions,
        rasterMip,
      )
      if (resourceRef && rasterMip >= 10 && isRecord(node.parameters.tiles)) {
        const size = resourceSizes.get(resourceRef)
        if (!size) throw new Error('画笔边界采样缺少真实源几何')
        const storage = resolveImageEditRasterStorageSizeV3(size, prepared.document.geometry)
        const rectangles = Object.keys(node.parameters.tiles).map((key) => imageEditRasterOverrideRectV3(storage, key))
        const sampleRegions = wholeSource ? [{ x: 0, y: 0, ...mipSize(size, rasterMip) }] : regions ?? []
        for (const region of sampleRegions) for (const point of imageEditRasterBoundaryBasePointsV3(region, rasterMip, size, rectangles)) {
          const request = sourceRequest(resourceRef, 0, Math.floor(point.x / 512), Math.floor(point.y / 512), bitDepth, size)
          requests.set(request.key, request)
        }
      }
    }
    if (node.mask && !isImageEditSparseMaskReferenceV3(node.mask)) {
      const regions = requirements.maskRegions.get(node.id)
      if (regions && RESOURCE_REF_PATTERN.test(node.mask.resourceId)) {
        addRegions(
          node.mask.resourceId as ImageEditorV3ResourceRef,
          regions,
          sourceMips.get(node.mask.resourceId as ImageEditorV3ResourceRef) ?? candidate.mip,
        )
      }
    }
  }
  return [...requests.values()]
}

export function estimateImageEditorViewportWorkingRegionPixelsV3(
  prepared: PreparedImageEditorViewportCompositeV3,
  candidate: ImageEditorViewportTileCandidateV3,
  wholeSource = false,
  resourceSizes: ReadonlyMap<string, ImageEditSize> = new Map(),
  sourceMips: ReadonlyMap<string, number> = new Map(),
  sourceDecodePixels = 0,
): number {
  // sourceDecodePixels 直接来自本候选的真实读取请求，包含 sparse 边界补读和源实际 mip。
  // 预算不得在这里用输出 mip 再推导一套源请求，否则缺层 pyramid 会低估 Float32 工作集。
  if (wholeSource) {
    const canvas = mipSize(prepared.document.geometry, candidate.mip)
    return Math.max(sourceDecodePixels, canvas.width * canvas.height, ...prepared.resourceRefs.map((resourceRef) => {
      const size = mipSize(
        resourceSizes.get(resourceRef) ?? prepared.document.geometry,
        sourceMips.get(resourceRef) ?? candidate.mip,
      )
      return size.width * size.height
    }))
  }
  const requirements = requirementsForCandidate(prepared, candidate, resourceSizes, sourceMips)
  return Math.max(sourceDecodePixels, ...[
    ...outputRegionsForCandidate(prepared, candidate),
    ...[...requirements.rasterRegions.values(), ...requirements.maskRegions.values()].flat(),
  ].map((region) => region.width * region.height))
}

function brushIntersectsRegion(
  request: ImageEditorPreviewBrushResourceRequestV3,
  region: ImageEditRect,
  mip: number,
): boolean {
  const [, xValue, yValue] = request.tileKey.split('/')
  const scale = 2 ** mip
  const left = Number(xValue) * 512 / scale
  const top = Number(yValue) * 512 / scale
  const right = (Number(xValue) * 512 + request.width) / scale
  const bottom = (Number(yValue) * 512 + request.height) / scale
  return left < region.x + region.width
    && right > region.x
    && top < region.y + region.height
    && bottom > region.y
}

export function collectImageEditorViewportBrushRequestsV3(
  prepared: PreparedImageEditorViewportCompositeV3,
  candidate: ImageEditorViewportTilePlanV3,
  wholeSource = false,
  resourceSizes: ReadonlyMap<string, ImageEditSize> = new Map(),
  sourceMips: ReadonlyMap<string, number> = new Map(),
): ImageEditorPreviewBrushResourceRequestV3[] {
  const activeBrushes = activeBrushResourceIds(prepared.plan)
  const masks = createImageEditorSparseMaskPlanV3(prepared.plan, prepared.document.geometry, prepared.resourceDescriptors)
  const activeMasks = new Set([...masks.byMaskId.values()].flatMap((mask) => [...mask.tiles.values()].map((tile) => tile.resourceId)))
  const brushRequests = collectImageEditorPreviewResourceRequestsV3(prepared.document, 1, prepared.resourceDescriptors, resourceSizes)
    .filter((request): request is ImageEditorPreviewBrushResourceRequestV3 => request.kind === 'brush-tile'
      && (request.storage === 'rgba-float32' ? activeBrushes : activeMasks).has(request.resourceId))
  if (wholeSource) return brushRequests
  const requirements = requirementsForCandidate(prepared, candidate, resourceSizes, sourceMips)
  const regionsByResource = new Map<string, Array<{ region: ImageEditRect; mip: number }>>()
  const append = (
    resourceId: string,
    regions: readonly ImageEditRect[],
    mip: number,
  ): void => {
    const current = regionsByResource.get(resourceId) ?? []
    current.push(...regions.map((region) => ({ region, mip })))
    regionsByResource.set(resourceId, current)
  }
  for (const node of requirements.plan.nodes) {
    const rasterRegions = requirements.rasterRegions.get(node.id)
    if (rasterRegions && node.definitionId === 'source.raster' && isRecord(node.parameters.tiles)) {
      const resourceRef = rasterResourceId(node)
      const mip = resourceRef
        ? sourceMips.get(resourceRef) ?? candidate.mip
        : candidate.mip
      for (const resourceId of Object.values(node.parameters.tiles)) {
        if (typeof resourceId === 'string') append(resourceId, rasterRegions, mip)
      }
    }
    const maskRegions = requirements.maskRegions.get(node.id)
    if (maskRegions && node.mask && isImageEditSparseMaskReferenceV3(node.mask)) {
      for (const resourceId of Object.values(node.mask.tiles)) {
        append(resourceId, maskRegions, candidate.mip)
      }
    }
  }
  return brushRequests.filter((request) => (
    regionsByResource.get(request.resourceId)?.some(({ region, mip }) => (
      brushIntersectsRegion(request, region, mip)
    )) ?? false
  ))
}
