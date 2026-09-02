import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  createFloat32PremultipliedRgbaTile,
  createTileRegion,
  executeImageEditCpuRenderRegionPlanV3,
  imageEditOutputMipSizeV3,
  imageEditOutputSizeV3,
  mapImageEditOutputMipPixelToSourceMipV3,
  resolveImageEditOutputGeometryV3,
  resolveImageEditOutputSourceRectAtMipV3,
  type Float32PremultipliedRgbaTile,
  type ImageEditRect,
  type ImageEditRenderPlanNode,
} from '@/core/imageEdit/v3'
import { isImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { convertPreviewWorkingSpaceToSrgbDisplayV3 } from './previewColorV3'
import { scaleImageEditorPreviewEffectsV3 } from './previewEffectScalingV3'
import { ImageEditorPreviewCustomEffectsV3 } from './previewCustomEffectsV3'
import { ImageEditorViewportGlobalAnalysisCacheV3 } from './viewportGlobalAnalysisV3'
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
  customEffects?: ImageEditorPreviewCustomEffectsV3
  globalAnalyses?: ImageEditorViewportGlobalAnalysisCacheV3
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

function projectToOutput(
  rendered: Float32PremultipliedRgbaTile,
  sourceRegion: ImageEditRect,
  outputRect: ImageEditRect,
  request: ImageEditorViewportCompositeRenderRequestV3,
): Float32PremultipliedRgbaTile {
  const geometry = resolveImageEditOutputGeometryV3(request.document.geometry)
  const data = new Float32Array(outputRect.width * outputRect.height * 4)
  for (let y = 0; y < outputRect.height; y += 1) {
    for (let x = 0; x < outputRect.width; x += 1) {
      const [sourceX, sourceY] = mapImageEditOutputMipPixelToSourceMipV3(
        outputRect.x + x,
        outputRect.y + y,
        request.plan.mip,
        geometry,
      )
      const localX = sourceX - sourceRegion.x
      const localY = sourceY - sourceRegion.y
      if (localX < 0 || localY < 0 || localX >= rendered.width || localY >= rendered.height) {
        throw new Error('视口输出像素映射超出当前 ROI')
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
    || request.plan.mipSize.width !== imageEditOutputMipSizeV3(request.document.geometry, request.plan.mip).width
    || request.plan.mipSize.height !== imageEditOutputMipSizeV3(request.document.geometry, request.plan.mip).height
  ) throw new Error('视口合成计划与文档几何不一致')
  const originalPlan = compileImageEditRenderPlanV3(request.document, registry, request.quality)
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
  const customEffects = dependencies.customEffects ?? new ImageEditorPreviewCustomEffectsV3()
  const ownsCustomEffects = dependencies.customEffects === undefined
  const originalById = new Map(originalPlan.nodes.map((node) => [node.id, node]))
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
  const renderRegion = async (
    executionPlan: typeof plan,
    sourceRegion: ImageEditRect,
  ): Promise<Float32PremultipliedRgbaTile | null> => executeImageEditCpuRenderRegionPlanV3(
    executionPlan,
    sourceRegion,
    {
      size: {
        width: Math.max(1, Math.ceil(request.document.geometry.width / (2 ** request.plan.mip))),
        height: Math.max(1, Math.ceil(request.document.geometry.height / (2 ** request.plan.mip))),
      },
      scaleX: 1 / (2 ** request.plan.mip),
      scaleY: 1 / (2 ** request.plan.mip),
      registry,
      signal,
      createTransparent: (region) => createTransparentImageEditorViewportRegionV3(
        region,
        request.document,
      ),
      loadRaster: async (node, region) => {
        const resourceId = rasterResourceId(node)
        const base = resourceId
          ? loadResource(resourceId, region)
          : createTransparentImageEditorViewportRegionV3(region, request.document)
        return applyImageEditorViewportBrushTilesV3(
          node,
          base,
          region,
          request.plan.mip,
          request.brushTiles,
          signal,
        )
      },
      rasterizeAnnotations: async (node, region) => rasterizeAnnotations(
        node,
        request.document,
        region,
        request.plan.mip,
        signal,
      ),
      loadMask: async (reference, _node, region) => {
        if (isImageEditSparseMaskReferenceV3(reference)) {
          return loadImageEditorViewportSparseMaskV3(
            reference,
            region,
            request.plan.mip,
            request.brushTiles,
            signal,
          )
        }
        return imageEditorViewportTileToMaskV3(loadResource(reference.resourceId, region))
      },
      executeCustomEffect: (node, source, mask, region) => {
        const originalNode = originalById.get(node.id)
        if (dependencies.globalAnalyses && originalNode) {
          return dependencies.globalAnalyses.execute({
            node,
            originalNode,
            source,
            mask,
            region,
            mip: request.plan.mip,
            document: request.document,
            quality: request.quality,
            required: request.phase === 'target',
            fallback: () => customEffects.execute(
              node, source, request.quality, request.document.color, mask,
            ),
          })
        }
        return customEffects.execute(node, source, request.quality, request.document.color, mask)
      },
    },
  )

  try {
    if (request.analysisRequested) {
      if (!dependencies.globalAnalyses) throw new Error('全局分析请求缺少 Worker 缓存')
      await dependencies.globalAnalyses.prepare({
        document: request.document,
        originalPlan,
        scaledPlan: plan,
        mip: request.plan.mip,
        quality: request.quality,
        signal,
        renderInput: renderRegion,
        executeCustomEffect: (node, source) => customEffects.execute(
          node, source, request.quality, request.document.color,
        ),
      })
    }
    for (const tileRequest of request.plan.tiles) {
      throwIfAborted(signal)
      const outputRegion = createTileRegion(
        imageEditOutputSizeV3(request.document.geometry),
        { mip: request.plan.mip, x: tileRequest.tileX, y: tileRequest.tileY },
        tileRequest.halo,
      )
      const sourceRegion = resolveImageEditOutputSourceRectAtMipV3(
        outputRegion.outputRect,
        resolveImageEditOutputGeometryV3(request.document.geometry),
        request.plan.mip,
      )
      if (
        outputRegion.sourceRect.x !== tileRequest.originX
        || outputRegion.sourceRect.y !== tileRequest.originY
        || outputRegion.sourceRect.width !== tileRequest.width
        || outputRegion.sourceRect.height !== tileRequest.height
      ) throw new Error('视口成品瓦片与计划区域不一致')
      const rendered = await renderRegion(plan, sourceRegion)
      const output = rendered
        ?? createTransparentImageEditorViewportRegionV3(sourceRegion, request.document)
      await onTile({
        outputRect: outputRegion.outputRect,
        tile: convertPreviewWorkingSpaceToSrgbDisplayV3(
          projectToOutput(output, sourceRegion, outputRegion.outputRect, request),
          request.document.color,
        ),
      })
    }
  } finally {
    if (ownsCustomEffects) customEffects.dispose()
  }
  return plan.diagnostics.map((diagnostic) => diagnostic.message)
}
