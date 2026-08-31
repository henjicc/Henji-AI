import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  createTileRegion,
  executeImageEditCpuRenderRegionPlanV3,
  type Float32PremultipliedRgbaTile,
  type ImageEditRect,
  type ImageEditRenderPlanNode,
} from '@/core/imageEdit/v3'
import { isImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { convertPreviewWorkingSpaceToSrgbDisplayV3 } from './previewColorV3'
import { scaleImageEditorPreviewEffectsV3 } from './previewEffectScalingV3'
import type { ImageEditorViewportCompositeRenderRequestV3 } from './viewportCompositeProtocolV3'
import {
  applyImageEditorViewportBrushTilesV3,
  createTransparentImageEditorViewportRegionV3,
  imageEditorViewportTileToMaskV3,
  loadImageEditorViewportSourceRegionV3,
  loadImageEditorViewportSparseMaskV3,
  rasterizeImageEditorViewportAnnotationsV3,
  viewportCompositeSourceTileKeyV3,
} from './viewportCompositePixelsV3'

const registry = createBuiltInImageEditRenderNodeRegistry()

export interface ImageEditorViewportRenderedRegionV3 {
  tile: Float32PremultipliedRgbaTile
  outputRect: ImageEditRect
}

export interface ImageEditorViewportCompositeRendererDependenciesV3 {
  rasterizeAnnotations?: typeof rasterizeImageEditorViewportAnnotationsV3
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = signal.reason instanceof Error ? signal.reason : new Error('视口分块渲染已取消')
  if (error.name === 'Error') error.name = 'AbortError'
  throw error
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rasterResourceId(node: ImageEditRenderPlanNode): string | null {
  const source = isRecord(node.parameters.source) ? node.parameters.source : null
  return source?.kind === 'resource' && typeof source.resourceId === 'string'
    ? source.resourceId
    : null
}

/**
 * 按计划逐片执行完整 RenderPlan；回调收到的永远是裁掉 halo 的最终合成像素。
 * 调用方可立即转成 ImageBitmap，因此无需同时保留整个视口的 Float32 输出。
 */
export async function renderImageEditorViewportCompositeV3(
  request: ImageEditorViewportCompositeRenderRequestV3,
  signal: AbortSignal,
  onTile: (result: ImageEditorViewportRenderedRegionV3) => void | Promise<void>,
  dependencies: ImageEditorViewportCompositeRendererDependenciesV3 = {},
): Promise<string[]> {
  if (
    request.plan.mip < 0
    || request.plan.mip > 30
    || request.plan.tiles.length === 0
    || request.plan.mipSize.width !== Math.max(1, Math.ceil(request.document.geometry.width / (2 ** request.plan.mip)))
    || request.plan.mipSize.height !== Math.max(1, Math.ceil(request.document.geometry.height / (2 ** request.plan.mip)))
  ) throw new Error('视口合成计划与文档几何不一致')
  const plan = compileImageEditRenderPlanV3(
    scaleImageEditorPreviewEffectsV3(request.document, 1 / (2 ** request.plan.mip)),
    registry,
    request.quality,
  )
  if (plan.diagnostics.length > 0) throw new Error('视口合成计划包含不可渲染图层')
  const sourceTiles = new Map(request.sourceTiles.map((tile) => [
    viewportCompositeSourceTileKeyV3(tile),
    tile,
  ]))
  if (sourceTiles.size !== request.sourceTiles.length) throw new Error('视口合成包含重复源瓦片')
  const rasterizeAnnotations = dependencies.rasterizeAnnotations
    ?? rasterizeImageEditorViewportAnnotationsV3

  for (const tileRequest of request.plan.tiles) {
    throwIfAborted(signal)
    const region = createTileRegion(
      request.document.geometry,
      { mip: request.plan.mip, x: tileRequest.tileX, y: tileRequest.tileY },
      tileRequest.halo,
    )
    if (
      region.sourceRect.x !== tileRequest.originX
      || region.sourceRect.y !== tileRequest.originY
      || region.sourceRect.width !== tileRequest.width
      || region.sourceRect.height !== tileRequest.height
    ) throw new Error('视口成品瓦片与计划区域不一致')
    const decoded = new Map<string, Float32PremultipliedRgbaTile>()
    const loadResource = (
      resourceId: string,
      requestedRegion: ImageEditRect,
    ): Float32PremultipliedRgbaTile => {
      const key = `${resourceId}:${requestedRegion.x}:${requestedRegion.y}:${requestedRegion.width}:${requestedRegion.height}`
      const cached = decoded.get(key)
      if (cached) return cached
      const result = loadImageEditorViewportSourceRegionV3(
        sourceTiles,
        resourceId,
        request.plan.mip,
        requestedRegion,
        request.document,
      )
      decoded.set(key, result)
      return result
    }
    const rendered = await executeImageEditCpuRenderRegionPlanV3(plan, region.outputRect, {
      size: request.plan.mipSize,
      scaleX: 1 / (2 ** request.plan.mip),
      scaleY: 1 / (2 ** request.plan.mip),
      registry,
      signal,
      createTransparent: (requestedRegion) => createTransparentImageEditorViewportRegionV3(
        requestedRegion,
        request.document,
      ),
      loadRaster: async (node, requestedRegion) => {
        const resourceId = rasterResourceId(node)
        const base = resourceId
          ? loadResource(resourceId, requestedRegion)
          : createTransparentImageEditorViewportRegionV3(requestedRegion, request.document)
        return applyImageEditorViewportBrushTilesV3(
          node,
          base,
          requestedRegion,
          request.plan.mip,
          request.brushTiles,
          signal,
        )
      },
      rasterizeAnnotations: async (node, requestedRegion) => rasterizeAnnotations(
        node,
        request.document,
        requestedRegion,
        request.plan.mip,
        signal,
      ),
      loadMask: async (reference, _node, requestedRegion) => {
        if (isImageEditSparseMaskReferenceV3(reference)) {
          return loadImageEditorViewportSparseMaskV3(
            reference,
            requestedRegion,
            request.plan.mip,
            request.brushTiles,
            signal,
          )
        }
        return imageEditorViewportTileToMaskV3(loadResource(reference.resourceId, requestedRegion))
      },
    })
    const output = rendered
      ?? createTransparentImageEditorViewportRegionV3(region.outputRect, request.document)
    await onTile({
      outputRect: region.outputRect,
      tile: convertPreviewWorkingSpaceToSrgbDisplayV3(output, request.document.color),
    })
  }
  return plan.diagnostics.map((diagnostic) => diagnostic.message)
}
