import type {
  ImageEditBrushResourceReferenceV3,
  ImageEditBrushTileV3,
  Float32MaskTile,
  Float32PremultipliedRgbaTile,
  ImageEditDocumentV3,
  ImageEditRenderPlanNode,
  ImageEditResourceBudget,
  ImageEditRenderScheduler,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3RenderedExportTile } from '@/commands/imageEditorV3Export'
import type {
  ImageEditorV3RasterExportDescription,
  ImageEditorV3ResourceDescriptor,
  ImageEditorV3SourceTile,
} from '@/platform/contracts/imageEditorV3'

export type ImageEditorV3ExportCapabilityCode =
  | 'COLOR_CONTRACT_MISMATCH'
  | 'HDR_RENDER_UNSUPPORTED'
  | 'LAYER_TRANSFORM_UNSUPPORTED'
  | 'MOSAIC_ANNOTATION_UNSUPPORTED'
  | 'OUTPUT_GEOMETRY_MISMATCH'
  | 'RENDER_NODE_UNSUPPORTED'
  | 'WORKING_SET_EXCEEDED'
  | 'ANNOTATION_RASTERIZER_UNAVAILABLE'

export class ImageEditorV3ExportCapabilityError extends Error {
  override readonly name = 'ImageEditorV3ExportCapabilityError'

  constructor(
    readonly code: ImageEditorV3ExportCapabilityCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export interface ImageEditorV3ExportSourceTileRequest {
  resourceRef: `sha256:${string}`
  mip: number
  tileX: number
  tileY: number
  halo: number
  bitDepth: 8 | 16 | 32
}

export interface ImageEditorV3ExportRenderRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface ImageEditorV3ExportAnnotationRasterizeRequest {
  node: ImageEditRenderPlanNode
  document: ImageEditDocumentV3
  region: ImageEditorV3ExportRenderRegion
  /** 区域坐标所属 mip；0 为文档原始像素。 */
  mip?: number
  signal: AbortSignal
}

export interface ImageEditorV3VgpuGlowAnalysisHandle {
  release(): void
}

export interface ImageEditorV3VgpuGlowRuntime {
  buildAnalysis(request: {
    node: ImageEditRenderPlanNode
    source: Float32PremultipliedRgbaTile
    document: ImageEditDocumentV3
    signal: AbortSignal
  }): Promise<ImageEditorV3VgpuGlowAnalysisHandle>
  render(request: {
    node: ImageEditRenderPlanNode
    source: Float32PremultipliedRgbaTile
    mask?: Float32MaskTile
    region: ImageEditorV3ExportRenderRegion
    document: ImageEditDocumentV3
    analysis: ImageEditorV3VgpuGlowAnalysisHandle
    signal: AbortSignal
  }): Promise<Float32PremultipliedRgbaTile>
  dispose(): void
}

export interface ImageEditorV3ExportRenderDependencies {
  readSourceTile?: (
    request: ImageEditorV3ExportSourceTileRequest,
    signal: AbortSignal,
  ) => Promise<ImageEditorV3SourceTile>
  rasterizeAnnotations?: (
    request: ImageEditorV3ExportAnnotationRasterizeRequest,
  ) => Promise<Float32PremultipliedRgbaTile>
  readBrushTiles?: (
    tiles: ReadonlyArray<{
      tileKey: string
      resource: ImageEditBrushResourceReferenceV3
    }>,
    signal: AbortSignal,
  ) => Promise<{
    tiles: Array<{ tileKey: string; tile: ImageEditBrushTileV3 }>
  }>
  scheduler?: ImageEditRenderScheduler
  resourceBudget?: ImageEditResourceBudget
  createVgpuGlowRuntime?: () => ImageEditorV3VgpuGlowRuntime
}

export interface RenderImageEditorV3ExportTilesRequest {
  /** 调用方传入持久化快照；入口会再次经过 V3 codec，避免渲染期间被外部修改。 */
  document: ImageEditDocumentV3
  /** 与 document 同一权威快照中的资源描述；画笔瓦片字节数不得由渲染层猜测。 */
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
  description: ImageEditorV3RasterExportDescription
  tileSize?: number
  sessionId?: string
  signal?: AbortSignal
  onTileRendered?: (completed: number, total: number) => void
}

export type ImageEditorV3ExportTileStream = AsyncIterable<ImageEditorV3RenderedExportTile>
