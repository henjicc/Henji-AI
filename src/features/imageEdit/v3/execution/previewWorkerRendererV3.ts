import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  executeImageEditCpuRenderPlanV3,
  type Float32PremultipliedRgbaTile,
  type ImageEditDocumentV3,
  type ImageEditLayerV3,
  type ImageEditRenderPlan,
} from '@/core/imageEdit/v3'
import { applyImageEditorPreviewGeometryV3 } from './previewGeometryV3'
import {
  convertPreviewWorkingSpaceToSrgbDisplayV3,
  convertSrgbProxyToPreviewWorkingSpaceV3,
  describeImageEditorPreviewColorDiagnosticsV3,
} from './previewColorV3'
import { ImageEditorPreviewCustomEffectsV3 } from './previewCustomEffectsV3'
import {
  applyPreviewBrushTileReplacementsV3,
  createPreviewBrushTileMapV3,
  createTransparentPreviewTileV3,
  loadPreviewMaskV3,
  rasterizePreviewAnnotationsV3,
  rasterizePreviewLayerV3,
  resolveImageEditorPreviewDimensionsV3,
  transformPreviewTileV3,
} from './previewPixelsV3'
import type {
  ImageEditorPreviewProxyV3,
  ImageEditorPreviewRenderRequestV3,
} from './previewProtocolV3'

const registry = createBuiltInImageEditRenderNodeRegistry()

function scalePreviewEffects(
  layers: readonly ImageEditLayerV3[],
  scale: number,
): ImageEditLayerV3[] {
  return layers.map((layer) => {
    if (layer.type === 'group') {
      return { ...layer, children: scalePreviewEffects(layer.children, scale) }
    }
    if (
      layer.type === 'effect'
      && layer.effectId === 'image.gaussian-blur-v2'
    ) {
      return {
        ...layer,
        params: {
          ...layer.params,
          mip: Math.max(0, Math.log2(1 / Math.max(scale, Number.EPSILON))),
        },
      }
    }
    if (layer.type === 'effect' && layer.effectId === 'image.blur') {
      const radiusPixels = Number(layer.params.radiusPixels ?? 0)
      return {
        ...layer,
        params: {
          ...layer.params,
          radiusPixels: Number.isFinite(radiusPixels) ? Math.max(0, radiusPixels * scale) : 0,
        },
      }
    }
    return layer
  })
}

function createPreviewRenderDocument(
  document: ImageEditDocumentV3,
  scale: number,
): ImageEditDocumentV3 {
  return { ...document, layers: scalePreviewEffects(document.layers, scale) }
}

export function compileImageEditorPreviewPlanV3(
  document: ImageEditDocumentV3,
  quality: ImageEditorPreviewRenderRequestV3['quality'],
  maxDimension: number,
): ImageEditRenderPlan {
  const dimensions = resolveImageEditorPreviewDimensionsV3(document, maxDimension)
  return compileImageEditRenderPlanV3(
    createPreviewRenderDocument(document, Math.min(dimensions.scaleX, dimensions.scaleY)),
    registry,
    quality,
  )
}

export interface ImageEditorPreviewRenderedTileV3 {
  tile: Float32PremultipliedRgbaTile
  diagnostics: string[]
}

export async function renderImageEditorPreviewTileV3(
  request: ImageEditorPreviewRenderRequestV3,
  customEffects: ImageEditorPreviewCustomEffectsV3,
  signal: AbortSignal,
): Promise<ImageEditorPreviewRenderedTileV3> {
  const dimensions = resolveImageEditorPreviewDimensionsV3(request.document, request.maxDimension)
  const plan = compileImageEditorPreviewPlanV3(
    request.document,
    request.quality,
    request.maxDimension,
  )
  const proxies = new Map<string, ImageEditorPreviewProxyV3>(
    request.proxies.map((proxy) => [proxy.resourceId, proxy]),
  )
  const brushTiles = createPreviewBrushTileMapV3(request.brushTiles)
  const rendered = await executeImageEditCpuRenderPlanV3(plan, {
    signal,
    loadRaster: async (node) => applyPreviewBrushTileReplacementsV3(
      node,
      convertSrgbProxyToPreviewWorkingSpaceV3(
        await rasterizePreviewLayerV3(node, proxies, dimensions),
        request.document.color,
      ),
      brushTiles,
      dimensions,
    ),
    rasterizeAnnotations: async (node) => convertSrgbProxyToPreviewWorkingSpaceV3(
      rasterizePreviewAnnotationsV3(node, request.document, dimensions),
      request.document.color,
    ),
    loadMask: async (reference) => loadPreviewMaskV3(reference.resourceId, proxies, dimensions),
    transformContent: async (content, transform) => transformPreviewTileV3(
      content,
      transform,
      dimensions,
    ),
    executeCustomEffect: async (node, source, mask) => customEffects.execute(
      node,
      source,
      request.quality,
      request.document.color,
      mask,
    ),
  })
  const base = rendered ?? createTransparentPreviewTileV3(dimensions.width, dimensions.height)
  const output = applyImageEditorPreviewGeometryV3(base, request.document, dimensions)
  return {
    tile: convertPreviewWorkingSpaceToSrgbDisplayV3(output, request.document.color),
    diagnostics: [
      ...plan.diagnostics.map((diagnostic) => diagnostic.message),
      ...describeImageEditorPreviewColorDiagnosticsV3(request.document.color),
    ],
  }
}
