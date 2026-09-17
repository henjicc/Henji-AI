import {
  deleteImageEditorV3DocumentIfRevision,
} from '@/commands/imageEditorV3'
import { createLogger } from '@/core/logging'
import { parseImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { getPlatform } from '@/platform/runtime'
import type { CanvasHistorySnapshot, CanvasState } from '@/stores/canvasStore'
import { getProjectRecord, listProjectSummaries } from '@/commands/projectState'
import { fromProjectRecord } from '@/stores/projectStoreSerialization'
import { deleteIdleImageEditDocumentV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { listCanvasProjectInstances } from './canvasProjectInstances'

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
const cleaning = new Set<string>()

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
  if (![...candidates.values()].some((candidate) => candidate.projectId === projectId)) return
  const persistedRefs = new Set<string>()
  try {
    for (const summary of await listProjectSummaries()) {
      const record = await getProjectRecord(summary.id)
      if (!record) continue
      const project = fromProjectRecord(record)
      const refs = collectMultiLayerDocumentLiveReferences({ ...project, dragHistorySnapshot: null, activeToolDialog: null })
      for (const ref of refs) persistedRefs.add(ref)
    }
  } catch (error) {
    logger.error('工程引用读取失败，保留图片文档候选', error, {
      event: 'canvas.multi_layer_document.release_candidate.references.failed', projectId,
    })
    return
  }
  for (const candidate of [...candidates.values()]) {
    const key = candidateKey(candidate)
    if (candidate.projectId !== projectId || cleaning.has(key) || persistedRefs.has(candidate.documentRef)) continue
    if (listCanvasProjectInstances().some((instance) => collectMultiLayerDocumentLiveReferences(instance.store.getState()).has(candidate.documentRef))) continue
    if ([...leases.values()].some((refs) => refs.has(candidate.documentRef))) continue
    cleaning.add(key)
    logger.info('多图层文档候选清理开始', {
      event: 'canvas.multi_layer_document.release_candidate.cleanup.start',
      projectId,
      nodeId: candidate.nodeId,
      context: { documentRef: candidate.documentRef, revision: candidate.revision },
    })
    try {
      if (!candidate.documentDeleted) {
        const removed = await deleteIdleImageEditDocumentV3(
          candidate.documentRef.slice('image-edit-v3:'.length), candidate.revision,
          async () => (await deleteImageEditorV3DocumentIfRevision({
            requestId: `image-editor-v3:release-candidate:${crypto.randomUUID()}`,
            documentRef: candidate.documentRef,
            expectedRevision: candidate.revision,
          })).deleted,
        )
        if (!removed) {
          logger.info('图片文档仍在使用或版本已变化，保留回收候选', {
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
    } finally { cleaning.delete(key) }
  }
}

export function createMultiLayerDocumentLifecyclePort(): Pick<
  MultiLayerDocumentNodePort,
  'markReleaseCandidate'
> {
  return {
    async markReleaseCandidate(input): Promise<void> {
      const projectId = input.projectId
      if (!projectId) throw new Error('文档回收缺少原画布工程')
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
  cleaning.clear()
}
