import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRenderQuality } from '@/core/imageEdit/v3/renderNodeDefinition'
import type { ImageEditMemoryLease, ImageEditResourceBudget } from '@/core/imageEdit/v3/resourceBudget'
import type { ImageEditRenderScheduler, ImageEditRenderPurpose, ImageEditRenderTaskKind } from '@/core/imageEdit/v3/renderScheduler'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorPreviewWorkerFactoryV3, ImageEditorPreviewWorkerEventV3 } from './previewProtocolV3'
import type { ImageEditorPreviewBrushTileReaderV3 } from './previewBrushTileLoaderV3'
import type { ImageEditorPreviewProxyReaderV3, ImageEditorPreviewPyramidDescriptorReaderV3, ImageEditorPreviewPyramidPrewarmerV3 } from './imageEditorPreviewResourcesV3'
import type { ImageEditorManagedPreviewResultV3, ImageEditorPreviewUrlFactoryV3 } from './imageEditorPreviewResultLeaseV3'
import type { ImageEditorWorkerCompletionV3 } from './imageEditorWorkerCompletionV3'

export interface ImageEditorManagedPreviewRequestV3 {
  document: ImageEditDocumentV3
  quality: ImageEditRenderQuality
  maxDimension: number
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
}

export interface ImageEditorPreviewClientOptionsV3 {
  sessionId: string
  workerFactory?: ImageEditorPreviewWorkerFactoryV3
  readFastProxy?: ImageEditorPreviewProxyReaderV3
  describePyramid?: ImageEditorPreviewPyramidDescriptorReaderV3
  prewarmPyramid?: ImageEditorPreviewPyramidPrewarmerV3
  readBrushTiles?: ImageEditorPreviewBrushTileReaderV3
  urlFactory?: ImageEditorPreviewUrlFactoryV3
  proxyCacheMaxBytes?: number
  brushCacheMaxBytes?: number
  brushTransferMaxBytes?: number
  resourceBudget?: ImageEditResourceBudget
  resourceBudgetConsumerId?: string
  renderScheduler?: ImageEditRenderScheduler
  /** 同一编辑会话内相互独立的画面流，例如 display 与 thumbnail。 */
  coalescingKey?: string
  taskKind?: ImageEditRenderTaskKind
  purpose?: ImageEditRenderPurpose
  priority?: number
  /** display 负责预热；thumbnail 等派生流应关闭，避免重复占用主进程额度。 */
  pyramidPrewarmEnabled?: boolean
}

export interface ScheduledJobV3 extends ImageEditorManagedPreviewRequestV3 {
  requestId: string
  sequence: number
  abortController: AbortController
  inputLeases: ImageEditMemoryLease[]
  transferLease: ImageEditMemoryLease | null
  workingLease: ImageEditMemoryLease | null
  outputLease: ImageEditMemoryLease | null
  posted: boolean
  renderTaskId: string
  workerCompletion: ImageEditorWorkerCompletionV3<ImageEditorPreviewWorkerEventV3>
  resolve: (result: ImageEditorManagedPreviewResultV3) => void
  reject: (error: Error) => void
}
