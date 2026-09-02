import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditResourceBudget } from '@/core/imageEdit/v3/resourceBudget'
import type { ImageEditRenderScheduler } from '@/core/imageEdit/v3/renderScheduler'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorViewportCompositeRenderedEventV3 } from './viewportCompositeProtocolV3'
import type { ImageEditorViewportCompositeWorkerFactoryV3 } from './viewportCompositeProtocolV3'
import type { ImageEditorPreviewBrushTileLoaderV3 } from './previewBrushTileLoaderV3'
import type { ImageEditorViewportTileSchedulerV3 } from './viewportTileSchedulerV3'
import type { ImageEditorViewportTransformV3 } from './viewportTilePlannerV3'

export class ImageEditorViewportCompositeSupersededErrorV3 extends Error {
  constructor() {
    super('视口合成请求已被更新版本取代')
    this.name = 'ImageEditorViewportCompositeSupersededErrorV3'
  }
}

export class ImageEditorViewportCompositeDisposedErrorV3 extends Error {
  constructor() {
    super('视口合成会话已经释放')
    this.name = 'ImageEditorViewportCompositeDisposedErrorV3'
  }
}

export interface ImageEditorViewportCompositeRequestV3 {
  document: ImageEditDocumentV3
  renderGeneration: number
  cameraSequence: number
  geometryHash: string
  quality: ImageEditRenderQuality
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
  viewport: ImageEditorViewportTransformV3
  viewportKey: string
}

export interface ImageEditorManagedViewportCompositeV3 {
  documentId: string
  revision: number
  renderGeneration: number
  cameraSequence: number
  geometryHash: string
  viewportKey: string
  mip: number
  documentWidth: number
  documentHeight: number
  diagnostics: string[]
  tiles: ImageEditorViewportCompositeRenderedEventV3['tiles']
  release(): void
}

export interface ImageEditorViewportCompositeClientOptionsV3 {
  sessionId: string
  workerFactory?: ImageEditorViewportCompositeWorkerFactoryV3
  scheduler?: Pick<ImageEditorViewportTileSchedulerV3, 'render' | 'cancel' | 'dispose'>
  resourceBudget?: ImageEditResourceBudget
  brushTileLoader?: ImageEditorPreviewBrushTileLoaderV3
  transferMaxBytes?: number
  resourceBudgetConsumerId?: string
  renderScheduler?: ImageEditRenderScheduler
}
