import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import { useImageEditorViewportCompositeV3 } from './useImageEditorViewportCompositeV3'
import { useManagedImageEditorPreviewV3 } from './useManagedImageEditorPreviewV3'
import type { ImageEditorViewportTransformV3 } from './viewportTilePlannerV3'

const EMPTY_RESOURCE_DESCRIPTORS: readonly ImageEditorV3ResourceDescriptor[] = []

interface ImageEditorDisplayViewportLayoutV3 {
  viewport: ImageEditorViewportTransformV3
  viewportKey: string
}

/**
 * 图片编辑器唯一显示管线：瞬态和稳定状态始终走同一个 ROI 分块内核。
 * 受管整图预览不再是交互显示 fallback，只保留给非交互消费者。
 */
export function useImageEditorDisplayPipelineV3(
  sessionId: string,
  snapshot: ImageEditCommandBusSnapshotV3,
  enabled: boolean,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[] = EMPTY_RESOURCE_DESCRIPTORS,
  layout: ImageEditorDisplayViewportLayoutV3 | null,
) {
  const hasPreviewOverrides = Object.keys(snapshot.previewOverrides).length > 0
  const viewportComposite = useImageEditorViewportCompositeV3(
    sessionId,
    snapshot,
    enabled,
    resourceDescriptors,
    layout,
  )
  const managedPreview = useManagedImageEditorPreviewV3(
    sessionId,
    snapshot,
    false,
    resourceDescriptors,
  )
  const exactViewportResult = viewportComposite.result
    && layout
    && viewportComposite.result.viewportKey === layout.viewportKey
      && viewportComposite.result.documentId === snapshot.document.id
      && viewportComposite.result.revision === snapshot.document.revision
      && viewportComposite.result.renderGeneration === viewportComposite.renderGeneration
      && viewportComposite.result.geometryHash === viewportComposite.geometryHash
    ? viewportComposite.result
    : null
  const viewportResult = exactViewportResult ?? viewportComposite.result

  return {
    hasPreviewOverrides,
    displaySource: viewportResult ? 'viewport' : 'empty',
    managedPreview,
    viewportComposite,
    viewportResult,
  }
}
