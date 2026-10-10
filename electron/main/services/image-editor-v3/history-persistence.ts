import {
  type ImageEditCommandHistorySnapshotV3,
} from '../../../../src/core/imageEdit/v3/commandHistoryCodec'
import { decodeImageEditDocumentV3 } from '../../../../src/core/imageEdit/v3/documentCodec'
import type { ImageEditDocumentV3 } from '../../../../src/core/imageEdit/v3/documentTypes'
import { collectImageEditJsonResourceIdsV3 } from '../../../../src/core/imageEdit/v3/resourceReferences'
import type { ImageEditHistoryResourceReferenceV3 } from '../../../../src/core/imageEdit/v3/commandTypes'
import type { ResourceId } from './contracts'
import { parseResourceId } from './resource-store'
import { decodeImageEditHistoryCheckpointV3, type ImageEditHistoryCheckpointV3 } from '../../../../src/core/imageEdit/v3/historyPaging/checkpoint'
import { decodeImageEditRuntimeHistoryV3, runtimeHistoryResourcesV3 } from '../../../../src/core/imageEdit/v3/historyPaging/runtimeSnapshot'
export { ImageEditHistoryPageStoreV3 } from './history-pages/store'

export function normalizePersistedImageEditDocumentV3(
  value: unknown,
  documentId: string,
  revision: number,
): ImageEditDocumentV3 {
  const decoded = decodeImageEditDocumentV3(value)
  if (!decoded.document) {
    throw new Error(`Invalid image editor V3 document: ${decoded.issues.join(', ')}`)
  }
  if (decoded.document.id !== documentId || decoded.document.revision !== revision) {
    throw new Error('Image editor V3 document body does not match its envelope')
  }
  return decoded.document
}

function retainedResources(
  snapshot: ImageEditCommandHistorySnapshotV3,
): ImageEditHistoryResourceReferenceV3[] {
  const byId = new Map<string, number | null>()
  for (const entry of [...snapshot.undo, ...snapshot.redo]) {
    for (const resource of entry.resources) {
      parseResourceId(resource.resourceId)
      const previous = byId.get(resource.resourceId)
      if (previous !== undefined && previous !== null
        && resource.byteSize !== null && previous !== resource.byteSize) {
        throw new Error(`History resource byte length conflict: ${resource.resourceId}`)
      }
      byId.set(resource.resourceId, previous ?? resource.byteSize)
    }
  }
  return [...byId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceId, byteSize]) => ({ resourceId, byteSize }))
}

/** 主进程与渲染层共用同一严格 codec，并额外验证快照确实可从当前文档撤销/重做。 */
export function normalizePersistedImageEditHistoryV3(
  value: unknown,
  document: unknown,
  documentId: string,
  revision: number,
): ImageEditCommandHistorySnapshotV3 | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted image edit history must be a structured snapshot')
  }
  const decoded = { snapshot: decodeImageEditRuntimeHistoryV3(value) }
  if (decoded.snapshot.documentId !== documentId || decoded.snapshot.headRevision !== revision) {
    throw new Error('Image edit history head does not match its document envelope')
  }
  retainedResources(decoded.snapshot)
  normalizePersistedImageEditDocumentV3(document, documentId, revision)
  return decoded.snapshot
}

export function collectPersistedImageEditHistoryResourcesV3(
  history: ImageEditCommandHistorySnapshotV3 | ImageEditHistoryCheckpointV3 | undefined,
): ImageEditHistoryResourceReferenceV3[] {
  if (history && 'format' in history) return [...history.resources, ...history.pages.map(page => ({ resourceId: page.resourceId, byteSize: page.byteSize }))]
  return history ? runtimeHistoryResourcesV3(history) : []
}

export function normalizePersistedImageEditCheckpointV3(value: unknown, documentId: string, revision: number): ImageEditHistoryCheckpointV3 | undefined {
  if (value === undefined) return undefined
  const checkpoint = decodeImageEditHistoryCheckpointV3(value)
  if (checkpoint.documentId !== documentId || checkpoint.headRevision !== revision) throw new Error('Image edit history checkpoint head does not match its document envelope')
  return checkpoint
}

export function mergePersistedImageEditResourceRefsV3(
  document: unknown,
  declared: readonly ResourceId[],
  previewRef: ResourceId | undefined,
  history: ImageEditCommandHistorySnapshotV3 | ImageEditHistoryCheckpointV3 | undefined,
): ResourceId[] {
  const additional = [
    ...declared,
    ...(previewRef ? [previewRef] : []),
    ...collectPersistedImageEditHistoryResourcesV3(history).map((resource) => resource.resourceId),
  ]
  return collectImageEditJsonResourceIdsV3(document, additional) as ResourceId[]
}
