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
 * 图片编辑器唯一显示管线：瞬态操作走 draft，稳定状态走视口瓦片，只有视口链路
 * 明确不可用时才启用整图 fallback。两条显示路径不会同时主动发起新任务。
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
    enabled && !hasPreviewOverrides,
    resourceDescriptors,
    layout,
  )
  const managedPreview = useManagedImageEditorPreviewV3(
    sessionId,
    snapshot,
    enabled && (hasPreviewOverrides || viewportComposite.fallbackRequired),
    resourceDescriptors,
  )
  const exactViewportResult = viewportComposite.result
    && layout
    && viewportComposite.result.viewportKey === layout.viewportKey
    && viewportComposite.result.documentId === snapshot.document.id
    && viewportComposite.result.revision === snapshot.document.revision
    ? viewportComposite.result
    : null
  const managedResultMatchesSnapshot = Boolean(
    managedPreview.result
      && managedPreview.resultDocumentId === snapshot.document.id
      && managedPreview.resultRevision === snapshot.document.revision
      && managedPreview.resultPreviewOverrides === snapshot.previewOverrides,
  )
  const showManagedDraft = hasPreviewOverrides
    && managedPreview.result !== null
    && managedPreview.resultDocumentId === snapshot.document.id
    && managedPreview.resultRevision === snapshot.document.revision
    && managedPreview.resultPreviewOverrides !== null
    && Object.keys(managedPreview.resultPreviewOverrides).length > 0
  const showCommittedDraft = !hasPreviewOverrides
    && !exactViewportResult
    && managedPreview.result !== null
    && managedPreview.resultDocumentId === snapshot.document.id
    && managedPreview.resultRevision === snapshot.document.revision - 1
    && managedPreview.resultPreviewOverrides !== null
    && Object.keys(managedPreview.resultPreviewOverrides).length > 0
  const showManagedFallback = !hasPreviewOverrides
    && !exactViewportResult
    && managedResultMatchesSnapshot
  const displayManagedResult = showManagedDraft || showCommittedDraft || showManagedFallback
  const viewportResult = displayManagedResult
    ? null
    : exactViewportResult ?? viewportComposite.result

  return {
    hasPreviewOverrides,
    displaySource: viewportResult ? 'viewport' : managedPreview.result ? 'managed' : 'empty',
    managedPreview,
    viewportComposite,
    viewportResult,
  }
}
