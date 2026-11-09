import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes'
import { CANVAS_TIDY_MODES, canvasTidyGeometryKey, solveCanvasTidy, type CanvasTidyCandidate, type CanvasTidyMode } from './canvasTidyLayout'
import type { CandidateIdentity } from '@/core/creativeIntent/contracts'
import { findCanvasProjectInstance, getCanvasProjectInstance, requireCanvasProjectInstance } from './canvasProjectInstances'
import { rememberCanvasUndo } from './canvasApplicationService'
import { CanvasApplicationError } from './canvasApplicationError'
import { verifyCanvasWrite } from './canvasQueryService'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { confirmCanvasPersistence, type CanvasCommitOptions } from './canvasPersistenceService'
import { applyCanvasNodePropertyPatches } from './canvasMutationService'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.canvas.tidy')
export interface CanvasTidyDraft {
  projectId: string
  baseline: string
  nodeIds: string[]
  pin: string | null
  candidates: CanvasTidyCandidate[]
}

export async function createCanvasTidyDraft(projectId: string, nodes: readonly CanvasNode[], nodeIds: string[], pin: string | null,
  edges: readonly CanvasEdge[]): Promise<CanvasTidyDraft> {
  const baseline = canvasTidyGeometryKey(nodes, edges)
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([baseline, nodeIds, pin])))
  const digest = `sha256:${Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('')}`
  const identity: CandidateIdentity = { sourceDraftDigest: digest, algorithmVersion: 'canvas-tidy-1', requestKey: digest,
    ownerRef: { kind: 'canvas.document', id: projectId }, targetBases: nodeIds.map(id => ({
      targetRef: { kind: 'canvas.node', id: `${projectId}:${id}` }, baseDigest: digest, geometryDigest: digest,
    })) }
  return { projectId, baseline, nodeIds, pin, candidates: CANVAS_TIDY_MODES.map(mode => solveCanvasTidy(nodes, nodeIds, pin, mode, identity, edges)) }
}

/** The exact positions remain ordinary canvas.node.position writes, shared with Pi/MCP. */
export async function applyCanvasTidyDraft(draft: CanvasTidyDraft, candidate: CanvasTidyCandidate, options: CanvasCommitOptions = {}): Promise<void> {
  const current = requireCanvasProjectInstance(draft.projectId).store.getState()
  if (canvasTidyGeometryKey(current.nodes, current.edges) !== draft.baseline) throw new Error('画布已变化，请重新整理后应用')
  if (!draft.candidates.includes(candidate) || candidate.unavailable || candidate.placements.length !== draft.nodeIds.length) throw new Error('整理方案不可用，请重新选择')
  const byId = new Map(current.nodes.map(node => [node.id, node]))
  const patches = candidate.placements.filter(p => {
    const node = byId.get(p.nodeId)!
    return node.position.x !== p.position.x || node.position.y !== p.position.y
  })
  if (!patches.length) return
  logger.info('应用画布整理', { event: 'canvas.tidy.apply.start', projectId: draft.projectId, count: patches.length })
  try {
    await applyCanvasNodePropertyPatches(draft.projectId, patches, options)
    logger.info('画布整理已保存', { event: 'canvas.tidy.apply.completed', projectId: draft.projectId, count: patches.length })
  } catch (error) {
    logger.error('画布整理应用失败', error, { event: 'canvas.tidy.apply.failed', projectId: draft.projectId })
    throw error
  }
}

export type CanvasAssistantTidyMode = Extract<CanvasTidyMode, 'flow' | 'grid' | 'align'>
export interface CanvasTidyRequest {
  nodeIds?: readonly string[]
  /** 与该节点连通（不分方向）的整条链。 */
  connectedTo?: string
  mode: CanvasAssistantTidyMode
  pinNodeId?: string
}

/** 要整理的节点：显式列出的节点并上 connectedTo 所在的连通链；都没给时整理画布顶层的全部节点。 */
export function collectCanvasTidyTargets(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], request: Omit<CanvasTidyRequest, 'mode'>): string[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const missing = [...(request.nodeIds ?? []), ...(request.connectedTo ? [request.connectedTo] : []), ...(request.pinNodeId ? [request.pinNodeId] : [])]
    .filter(id => !byId.has(id))
  if (missing.length) {
    throw notExecutedFailure(new CanvasApplicationError('NOT_FOUND', `画布中没有这些节点：${missing.join('、')}`, true, { missing }))
  }
  if (!request.nodeIds?.length && !request.connectedTo) return nodes.filter(node => !node.hidden && !node.parentId).map(node => node.id)
  const targets = new Set(request.nodeIds ?? [])
  if (request.connectedTo) {
    const neighbours = new Map<string, string[]>()
    for (const edge of edges) {
      neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target])
      neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source])
    }
    const queue = [request.connectedTo]
    const seen = new Set(queue)
    while (queue.length) {
      const id = queue.shift()!
      for (const next of neighbours.get(id) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next) }
    }
    seen.forEach(id => targets.add(id))
  }
  return [...targets].filter(id => !byId.get(id)?.hidden)
}

/** 助手与外部智能体的整理入口：与界面同一套求解与一次撤销的位置写入，结果从画布回读。 */
export async function tidyCanvasNodes(projectId: string, request: CanvasTidyRequest): Promise<Record<string, unknown>> {
  if (!findCanvasProjectInstance(projectId)) await getCanvasProjectInstance(projectId)
  const { nodes, edges } = requireCanvasProjectInstance(projectId).store.getState()
  const nodeIds = collectCanvasTidyTargets(nodes, edges, request)
  if (nodeIds.length < 2) {
    throw notExecutedFailure(new CanvasApplicationError('INVALID_INPUT', `需要至少两个可见节点才能整理，当前只找到 ${nodeIds.length} 个`, true))
  }
  if (request.pinNodeId && !nodeIds.includes(request.pinNodeId)) {
    throw notExecutedFailure(new CanvasApplicationError('INVALID_INPUT', '钉住的节点不在要整理的节点里', true, { pinNodeId: request.pinNodeId }))
  }
  const draft = await createCanvasTidyDraft(projectId, nodes, nodeIds, request.pinNodeId ?? null, edges)
  const candidate = draft.candidates.find(item => item.mode === request.mode)!
  if (candidate.unavailable) throw notExecutedFailure(new CanvasApplicationError('INVALID_INPUT', candidate.unavailable, true, { mode: request.mode }))
  const before = new Map(nodes.map(node => [node.id, node.position]))
  const movedNodeIds = candidate.placements
    .filter(p => before.get(p.nodeId)?.x !== p.position.x || before.get(p.nodeId)?.y !== p.position.y).map(p => p.nodeId)
  // 先写入、记下撤销点，再等保存：保存期间落盘的其他改动不能被误记成这次整理的撤销点。
  await applyCanvasTidyDraft(draft, candidate, { deferCommit: true })
  const undoRef = movedNodeIds.length ? rememberCanvasUndo(projectId, 'tidy_nodes') : undefined
  const current = new Map(requireCanvasProjectInstance(projectId).store.getState().nodes.map(node => [node.id, node.position]))
  const positions = candidate.placements.map(p => ({ nodeId: p.nodeId, x: current.get(p.nodeId)?.x ?? p.position.x, y: current.get(p.nodeId)?.y ?? p.position.y }))
  const applied = candidate.placements.every(p => current.get(p.nodeId)?.x === p.position.x && current.get(p.nodeId)?.y === p.position.y)
  if (movedNodeIds.length) await confirmCanvasPersistence(projectId)
  const saved = movedNodeIds.length ? await verifyCanvasWrite(projectId) : { verified: true }
  return {
    projectId, mode: request.mode, movedCount: movedNodeIds.length, movedNodeIds, positions,
    ...(undoRef ? { undoRef } : {}),
    verification: { verified: applied && saved.verified, condition: '已回读画布节点位置并核对已保存的画布文档。' },
  }
}
