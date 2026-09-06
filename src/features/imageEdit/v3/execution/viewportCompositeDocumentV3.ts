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
  type ImageEditRenderPlanNode,
  type ImageEditOutputGeometryV3,
  type ImageEditSize,
} from '@/core/imageEdit/v3'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import { resolveImageEditRasterSourceExtentV3, resolveImageEditRasterStorageSizeV3, imageEditRasterOverrideRectV3 } from '@/core/imageEdit/v3/execution/rasterSourceGeometry'
import { imageEditRasterBoundaryBasePointsV3 } from '@/core/imageEdit/v3/execution/rasterTileReplacement'
import type {
  ImageEditorV3ResourceDescriptor,
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
  primaryResourceRef: ImageEditorV3ResourceRef
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

/** 顺着单输入效果链找到栅格源，使图层仿射以资源自身几何而非文档几何裁剪。 */
export function createImageEditorViewportSourceSizeResolverV3(
  plan: ImageEditRenderPlan,
  resourceSizes: ReadonlyMap<string, ImageEditSize>,
  fallback: ImageEditSize,
  mip: number,
  canvasSize: ImageEditSize = { width: fallback.width * (2 ** mip), height: fallback.height * (2 ** mip) },
): (node: ImageEditRenderPlanNode) => ImageEditSize {
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]))
  const resolve = (node: ImageEditRenderPlanNode, seen: Set<string>): ImageEditSize => {
    if (seen.has(node.id)) return fallback
    seen.add(node.id)
    // composite 的输入/输出都在文档坐标系；只有它逆变换后的 content 链使用源几何。
    if (node.definitionId === 'composite.layer' || node.definitionId === 'vector.annotation') {
      return fallback
    }
    const resourceRef = rasterResourceId(node)
    if (node.definitionId === 'source.raster') {
      const size = resourceRef ? resourceSizes.get(resourceRef) : undefined
      const keys = isRecord(node.parameters.tiles) ? Object.keys(node.parameters.tiles) : []
      return mipSize(resolveImageEditRasterSourceExtentV3(size ?? null, canvasSize, keys), mip)
    }
    if (node.inputNodeIds.length !== 1) return fallback
    const input = nodes.get(node.inputNodeIds[0] ?? '')
    return input ? resolve(input, seen) : fallback
  }
  return (node) => resolve(node, new Set())
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
  if (resourceRefs.length === 0) {
    throw new ImageEditorViewportCompositeUnsupportedErrorV3('当前文档没有可规划的图片金字塔资源')
  }
  return {
    document,
    quality,
    plan,
    outputGeometry: resolveImageEditOutputGeometryV3(document.geometry),
    resourceRefs,
    primaryResourceRef: resourceRefs[0],
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
        resolveSourceSize: createImageEditorViewportSourceSizeResolverV3(
          plan,
          resourceSizes,
          mipSize(prepared.document.geometry, candidate.mip),
          candidate.mip,
          prepared.document.geometry,
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
): ImageEditorViewportTileRequestV3[] {
  const requests = new Map<string, ImageEditorViewportTileRequestV3>()
  const addRegions = (resourceRef: ImageEditorV3ResourceRef, regions: readonly ImageEditRect[]): void => {
    const sourceSize = resourceSizes.get(resourceRef) ?? prepared.document.geometry
    for (const region of regions) {
      for (const coordinate of enumerateTilesForRect(sourceSize, candidate.mip, region)) {
        const request = sourceRequest(
          resourceRef,
          candidate.mip,
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
      const size = mipSize(resourceSizes.get(resourceRef) ?? prepared.document.geometry, candidate.mip)
      addRegions(resourceRef, [{ x: 0, y: 0, ...size }])
    }
  }
  const requirements = requirementsForCandidate(prepared, candidate, resourceSizes)
  for (const node of requirements.plan.nodes) {
    if (node.definitionId === 'source.raster') {
      const resourceRef = rasterResourceId(node)
      const regions = requirements.rasterRegions.get(node.id)
      if (resourceRef && regions) addRegions(resourceRef, regions)
      if (resourceRef && candidate.mip >= 10 && isRecord(node.parameters.tiles)) {
        const size = resourceSizes.get(resourceRef)
        if (!size) throw new Error('画笔边界采样缺少真实源几何')
        const storage = resolveImageEditRasterStorageSizeV3(size, prepared.document.geometry)
        const rectangles = Object.keys(node.parameters.tiles).map((key) => imageEditRasterOverrideRectV3(storage, key))
        const sampleRegions = wholeSource ? [{ x: 0, y: 0, ...mipSize(size, candidate.mip) }] : regions ?? []
        for (const region of sampleRegions) for (const point of imageEditRasterBoundaryBasePointsV3(region, candidate.mip, size, rectangles)) {
          const request = sourceRequest(resourceRef, 0, Math.floor(point.x / 512), Math.floor(point.y / 512), bitDepth, size)
          requests.set(request.key, request)
        }
      }
    }
    if (node.mask && !isImageEditSparseMaskReferenceV3(node.mask)) {
      const regions = requirements.maskRegions.get(node.id)
      if (regions && RESOURCE_REF_PATTERN.test(node.mask.resourceId)) {
        addRegions(node.mask.resourceId as ImageEditorV3ResourceRef, regions)
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
): number {
  // 跨 sparse/source 的像素中心足迹可能要求 mip0 底图；同时计入解码后的 Float32 常驻区域。
  const boundaryPixels = candidate.mip >= 10
    ? createImageEditorViewportSourceTileRequestsV3(prepared, candidate, 32, wholeSource, resourceSizes)
      .filter((tile) => tile.mip === 0).reduce((sum, tile) => sum + tile.width * tile.height, 0)
    : 0
  if (wholeSource) {
    const canvas = mipSize(prepared.document.geometry, candidate.mip)
    return Math.max(boundaryPixels, canvas.width * canvas.height, ...prepared.resourceRefs.map((resourceRef) => {
      const size = mipSize(resourceSizes.get(resourceRef) ?? prepared.document.geometry, candidate.mip)
      return size.width * size.height
    }))
  }
  const requirements = requirementsForCandidate(prepared, candidate, resourceSizes)
  return [
    ...outputRegionsForCandidate(prepared, candidate),
    ...[...requirements.rasterRegions.values(), ...requirements.maskRegions.values()].flat(),
  ].reduce((largest, region) => Math.max(largest, region.width * region.height), boundaryPixels)
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
): ImageEditorPreviewBrushResourceRequestV3[] {
  const activeBrushes = activeBrushResourceIds(prepared.plan)
  const masks = createImageEditorSparseMaskPlanV3(prepared.plan, prepared.document.geometry, prepared.resourceDescriptors)
  const activeMasks = new Set([...masks.byMaskId.values()].flatMap((mask) => [...mask.tiles.values()].map((tile) => tile.resourceId)))
  const brushRequests = collectImageEditorPreviewResourceRequestsV3(prepared.document, 1, prepared.resourceDescriptors, resourceSizes)
    .filter((request): request is ImageEditorPreviewBrushResourceRequestV3 => request.kind === 'brush-tile'
      && (request.storage === 'rgba-float32' ? activeBrushes : activeMasks).has(request.resourceId))
  if (wholeSource) return brushRequests
  const requirements = requirementsForCandidate(prepared, candidate, resourceSizes)
  const regionsByResource = new Map<string, ImageEditRect[]>()
  const append = (resourceId: string, regions: readonly ImageEditRect[]): void => {
    const current = regionsByResource.get(resourceId) ?? []
    current.push(...regions)
    regionsByResource.set(resourceId, current)
  }
  for (const node of requirements.plan.nodes) {
    const rasterRegions = requirements.rasterRegions.get(node.id)
    if (rasterRegions && node.definitionId === 'source.raster' && isRecord(node.parameters.tiles)) {
      for (const resourceId of Object.values(node.parameters.tiles)) {
        if (typeof resourceId === 'string') append(resourceId, rasterRegions)
      }
    }
    const maskRegions = requirements.maskRegions.get(node.id)
    if (maskRegions && node.mask && isImageEditSparseMaskReferenceV3(node.mask)) {
      for (const resourceId of Object.values(node.mask.tiles)) append(resourceId, maskRegions)
    }
  }
  return brushRequests.filter((request) => (
    regionsByResource.get(request.resourceId)?.some((region) => (
      brushIntersectsRegion(request, region, candidate.mip)
    )) ?? false
  ))
}
