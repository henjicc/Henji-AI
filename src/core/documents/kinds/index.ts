import { audioEditDocumentKind } from './audioEdit'
import { cameraStageDocumentKind } from './cameraStage'
import { canvasDocumentKind } from './canvas'
import { imageDocumentKind } from './imageDocument'
import { createDocumentKindRegistry } from './registry'
import { videoEditDocumentKind } from './videoEdit'
import { screenRecordingDocumentKind } from './screenRecording'
import { webRecordingDocumentKind } from './webRecording'

export {
  createDocumentKindRegistry,
  defineSkeletonDocumentKind,
  documentNameForKind,
  DocumentKindError,
  readableDocumentExtensions,
  usesLegacyDocumentExtension,
  placeholderContentSchema,
  type DocumentKindDescriptor,
  type DocumentKindRegistry,
  type DocumentStorageMode,
} from './registry'

/** 登记表：新增文档类型时在 kinds/ 下新增一个文件，再在这里登记一行。 */
export const DOCUMENT_KINDS = [
  videoEditDocumentKind,
  canvasDocumentKind,
  audioEditDocumentKind,
  cameraStageDocumentKind,
  imageDocumentKind,
  screenRecordingDocumentKind,
  webRecordingDocumentKind,
] as const

export const documentKindRegistry = createDocumentKindRegistry(DOCUMENT_KINDS)
