export type ImageEditorDiagnosticHostV3 = 'full' | 'quick' | 'canvas-edit' | 'mask'

export interface ImageEditorDiagnosticLayerSummaryV3 {
  raster: number
  annotation: number
  effect: number
  adjustment: number
  group: number
  masked: number
  hidden: number
  locked: number
  annotationObjects: number
  effectIds: string[]
}

/**
 * 渲染层只提交排障所需的结构摘要。禁止把源地址、图层名称或标注内容放入此契约。
 */
export interface ImageEditorDiagnosticBundleRequest {
  host: ImageEditorDiagnosticHostV3
  documentId: string
  revision: number
  sessionId?: string
  source: {
    mediaTypes: string[]
    width: number
    height: number
    byteLength: number
  }
  layers: ImageEditorDiagnosticLayerSummaryV3
}

export type ImageEditorDiagnosticBundleResult =
  | { status: 'cancelled' }
  | { status: 'completed'; fileName: string }
