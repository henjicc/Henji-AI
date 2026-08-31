import type { ReactNode } from 'react'

import type { MarkItem } from '@/core/imageEdit/types'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import type {
  ImageEditorHostProfileIdV3,
  ImageEditorHostProfileV3,
  ImageEditorToolIdV3,
} from '../application/imageEditorHostProfiles'
import type {
  ImageEditCropRectV3,
  ImageEditDocumentV3,
  ImageEditOrientationV3,
} from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditJsonObjectV3,
  ImageEditLayerV3,
  ImageEditMaskReferenceV3,
  ImageEditTransformV3,
} from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'

export type ImageEditorV3PreviewOutput =
  | { kind: 'url'; url: string; release?: () => void }
  | {
      kind: 'frame'
      frame: CanvasImageSource
      width: number
      height: number
      release?: () => void
    }
  | { kind: 'content'; content: ReactNode }

export interface ImageEditorV3PreviewRendererContext {
  sourceImageUrl: string
  snapshot: ImageEditCommandBusSnapshotV3
  activeTool: ImageEditorToolIdV3
  sessionId: string
}

export type ImageEditorV3PreviewRenderer = (
  context: ImageEditorV3PreviewRendererContext,
) => ImageEditorV3PreviewOutput

export interface ImageEditorV3Props {
  sourceImageUrl: string
  document: ImageEditDocumentV3
  historySnapshot?: ImageEditCommandHistorySnapshotV3 | null
  profileId: ImageEditorHostProfileIdV3
  /** 宿主只在首次挂载时指定焦点；后续选择仍属于会话态，不进文档。 */
  initialSelectedLayerId?: string
  initialToolId?: ImageEditorToolIdV3
  onDocumentChange: (document: ImageEditDocumentV3) => void
  /** 只在持久命令、撤销/重做或清空历史后触发；pointer preview 不会进入该回调。 */
  onPersistenceChange?: (snapshot: ImageEditPersistenceSnapshotV3) => void
  toolbarLeading?: ReactNode
  toolbarActions?: ReactNode
  previewRenderer?: ImageEditorV3PreviewRenderer
  annotationOverlay?: ReactNode
  /** 已有内容寻址资源的实际字节数；读取可编辑文件中的稀疏画笔瓦片时用于完整性校验。 */
  resourceByteSizes?: Readonly<Record<string, number>>
  /** 权威快照或受管写入返回的资源元数据；managed preview 据此分流图片与画笔瓦片。 */
  resourceDescriptors?: readonly ImageEditorV3ResourceDescriptor[]
  /** 蒙版像素由资源层创建，界面只负责把返回的引用写入文档。 */
  onCreateMaskResource?: (
    layer: ImageEditLayerV3,
    signal?: AbortSignal,
  ) => Promise<string | null>
  className?: string
}

export interface ImageEditorV3Controller {
  sessionId: string
  profile: ImageEditorHostProfileV3
  document: ImageEditDocumentV3
  updateLayerCommon: (
    layerId: string,
    patch: Partial<Pick<ImageEditLayerV3, 'name' | 'visible' | 'locked' | 'opacity' | 'blendMode' | 'transform'>>,
  ) => void
  updateLayerParams: (layerId: string, params: ImageEditJsonObjectV3) => void
  addAnnotation: (layerId: string, annotation: MarkItem, index?: number) => void
  updateAnnotation: (layerId: string, annotationId: string, annotation: MarkItem) => void
  deleteAnnotation: (layerId: string, annotationId: string) => void
  addLayer: (layer: ImageEditLayerV3, parentId: string | null, index: number) => void
  deleteLayer: (layerId: string) => void
  duplicateLayer: (layerId: string, parentId: string | null, index: number) => string | null
  moveLayer: (layerId: string, parentId: string | null, index: number) => void
  groupLayers: (layerIds: readonly string[], groupName: string) => string
  ungroupLayer: (groupId: string) => void
  updateGroupIsolation: (layerId: string, isolated: boolean) => void
  setLayerMask: (layerId: string, mask: ImageEditMaskReferenceV3 | null) => void
  setOutputGeometryPreview: (
    previewId: string,
    orientation: ImageEditOrientationV3,
    crop: ImageEditCropRectV3 | null,
  ) => void
  clearOutputGeometryPreview: (previewId: string) => void
  commitOutputGeometryPreview: (
    previewId: string,
    orientation: ImageEditOrientationV3,
    crop: ImageEditCropRectV3 | null,
  ) => void
  setParameterPreview: (previewId: string, layerId: string, value: unknown) => void
  clearParameterPreview: (previewId: string) => void
  setTransformPreview: (
    previewId: string,
    layerId: string,
    transform: ImageEditTransformV3,
  ) => void
  clearTransformPreview: (previewId: string) => void
  commitTransformPreview: (
    previewId: string,
    layerId: string,
    transform: ImageEditTransformV3,
  ) => void
  commitLayerCommonPreview: (
    previewId: string,
    layerId: string,
    patch: Partial<Pick<ImageEditLayerV3, 'opacity'>>,
  ) => void
  commitLayerParamsPreview: (
    previewId: string,
    layerId: string,
    params: ImageEditJsonObjectV3,
  ) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}
