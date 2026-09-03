import {
  deleteImageEditorV3DocumentIfRevision,
} from '@/commands/imageEditorV3'
import { createLogger } from '@/core/logging'
import { parseImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { getPlatform } from '@/platform/runtime'
import { useCanvasStore, type CanvasHistorySnapshot, type CanvasState } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import type { CanvasNode } from '../domain/canvasNodes'
import type { MultiLayerDocumentNodePort } from './multiLayerDocumentNodeApplicationContracts'

const logger = createLogger('features.canvas.multi_layer_document_lifecycle')

interface ReleaseCandidate {
  projectId: string
  nodeId: string
  documentRef: `image-edit-v3:${string}`
  revision: number
  /** 文档已精确删除但资源 GC 尚未完成；后续维护只重试 GC。 */
  documentDeleted?: boolean
}

const candidates = new Map<string, ReleaseCandidate>()
const leases = new Map<string, Set<string>>()

function candidateKey(candidate: Pick<ReleaseCandidate, 'documentRef' | 'revision'>): string {
  return `${candidate.documentRef}@${candidate.revision}`
}

function nodeDocumentRefs(nodes: readonly CanvasNode[]): Set<string> {
  const refs = new Set<string>()
  for (const node of nodes) {
    const imageUrl = typeof node.data.imageUrl === 'string' ? node.data.imageUrl : ''
    try {
      const session = parseImageEditSessionReferenceV3(node.data.imageEditSession, imageUrl)
      if (session) refs.add(session.documentRef)
    } catch {
      // 损坏引用由节点迁移/打开路径报告；清理器只做保守跳过。
    }
  }
  return refs
}

function snapshotRefs(snapshots: readonly CanvasHistorySnapshot[]): Set<string> {
  const refs = new Set<string>()
  for (const snapshot of snapshots) {
    for (const ref of nodeDocumentRefs(snapshot.nodes)) refs.add(ref)
  }
  return refs
}

export function collectMultiLayerDocumentLiveReferences(
  state: Pick<CanvasState, 'nodes' | 'history' | 'dragHistorySnapshot' | 'activeToolDialog'>,
): Set<string> {
  const refs = nodeDocumentRefs(state.nodes)
  for (const ref of snapshotRefs(state.history.past)) refs.add(ref)
  for (const ref of snapshotRefs(state.history.future)) refs.add(ref)
  if (state.dragHistorySnapshot) {
    for (const ref of nodeDocumentRefs(state.dragHistorySnapshot.nodes)) refs.add(ref)
  }
  const activeNode = state.activeToolDialog
    ? state.nodes.find((node) => node.id === state.activeToolDialog?.nodeId)
    : null
  if (activeNode) {
    for (const ref of nodeDocumentRefs([activeNode])) refs.add(ref)
  }
  for (const leasedRefs of leases.values()) {
    for (const ref of leasedRefs) refs.add(ref)
  }
  return refs
}

export function retainMultiLayerDocumentReferences(documentRefs: readonly string[]): () => void {
  const token = crypto.randomUUID()
  leases.set(token, new Set(documentRefs.filter((ref) => ref.startsWith('image-edit-v3:'))))
  return () => { leases.delete(token) }
}

export async function maintainMultiLayerDocumentReleaseCandidates(projectId: string): Promise<void> {
  const project = useProjectStore.getState()
  if (project.currentProjectId !== projectId || project.currentProject?.id !== projectId) return
  const live = collectMultiLayerDocumentLiveReferences(useCanvasStore.getState())
  for (const candidate of [...candidates.values()]) {
    if (candidate.projectId !== projectId || live.has(candidate.documentRef)) continue
    logger.info('多图层文档候选清理开始', {
      event: 'canvas.multi_layer_document.release_candidate.cleanup.start',
      projectId,
      nodeId: candidate.nodeId,
      context: { documentRef: candidate.documentRef, revision: candidate.revision },
    })
    try {
      if (!candidate.documentDeleted) {
        const result = await deleteImageEditorV3DocumentIfRevision({
          requestId: `image-editor-v3:release-candidate:${crypto.randomUUID()}`,
          documentRef: candidate.documentRef,
          expectedRevision: candidate.revision,
        })
        if (!result.deleted) {
          logger.warn('多图层文档候选版本已变化，保留候选等待后续维护', {
            event: 'canvas.multi_layer_document.release_candidate.cleanup.failed',
            projectId,
            nodeId: candidate.nodeId,
            context: { documentRef: candidate.documentRef, revision: candidate.revision },
          })
          continue
        }
        candidate.documentDeleted = true
      }
      await getPlatform().imageEditorV3.collectGarbage({
        requestId: `image-editor-v3:release-candidate-gc:${crypto.randomUUID()}`,
        retainedResourceRefs: [],
      })
      candidates.delete(candidateKey(candidate))
      logger.info('多图层文档候选清理完成', {
        event: 'canvas.multi_layer_document.release_candidate.cleanup.completed',
        projectId,
        nodeId: candidate.nodeId,
      })
    } catch (error) {
      logger.error('多图层文档候选清理失败', error, {
        event: 'canvas.multi_layer_document.release_candidate.cleanup.failed',
        projectId,
        nodeId: candidate.nodeId,
        context: { documentRef: candidate.documentRef, revision: candidate.revision },
      })
    }
  }
}

export function createMultiLayerDocumentLifecyclePort(): Pick<
  MultiLayerDocumentNodePort,
  'markReleaseCandidate'
> {
  return {
    async markReleaseCandidate(input): Promise<void> {
      const projectId = useProjectStore.getState().currentProjectId
      if (!projectId) throw new Error('当前没有可维护的画布项目')
      const candidate: ReleaseCandidate = {
        projectId,
        nodeId: input.nodeId,
        documentRef: input.session.documentRef,
        revision: input.session.revision,
      }
      const key = candidateKey(candidate)
      const previous = candidates.get(key)
      candidates.set(key, previous?.documentDeleted
        ? { ...candidate, documentDeleted: true }
        : candidate)
      await maintainMultiLayerDocumentReleaseCandidates(projectId)
    },
  }
}

export function resetMultiLayerDocumentLifecycleForTests(): void {
  candidates.clear()
  leases.clear()
}
