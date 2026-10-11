import type { CanvasNode } from '../domain/canvasNodes'
import { CANVAS_TIDY_MODES, canvasTidyGeometryKey, solveCanvasTidy, type CanvasTidyCandidate } from './canvasTidyLayout'
import type { CandidateIdentity } from '@/core/creativeIntent/contracts'
import { requireCanvasProjectInstance } from './canvasProjectInstances'
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

export async function createCanvasTidyDraft(projectId: string, nodes: readonly CanvasNode[], nodeIds: string[], pin: string | null): Promise<CanvasTidyDraft> {
  const baseline = canvasTidyGeometryKey(nodes)
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([baseline, nodeIds, pin])))
  const digest = `sha256:${Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('')}`
  const identity: CandidateIdentity = { sourceDraftDigest: digest, algorithmVersion: 'canvas-tidy-1', requestKey: digest,
    ownerRef: { kind: 'canvas.document', id: projectId }, targetBases: nodeIds.map(id => ({
      targetRef: { kind: 'canvas.node', id: `${projectId}:${id}` }, baseDigest: digest, geometryDigest: digest,
    })) }
  return { projectId, baseline, nodeIds, pin, candidates: CANVAS_TIDY_MODES.map(mode => solveCanvasTidy(nodes, nodeIds, pin, mode, identity)) }
}

/** The exact positions remain ordinary canvas.node.position writes, shared with Pi/MCP. */
export async function applyCanvasTidyDraft(draft: CanvasTidyDraft, candidate: CanvasTidyCandidate): Promise<void> {
  const current = requireCanvasProjectInstance(draft.projectId).store.getState()
  if (canvasTidyGeometryKey(current.nodes) !== draft.baseline) throw new Error('画布已变化，请重新整理后应用')
  if (!draft.candidates.includes(candidate) || candidate.unavailable || candidate.placements.length !== draft.nodeIds.length) throw new Error('整理方案不可用，请重新选择')
  const byId = new Map(current.nodes.map(node => [node.id, node]))
  const patches = candidate.placements.filter(p => {
    const node = byId.get(p.nodeId)!
    return node.position.x !== p.position.x || node.position.y !== p.position.y
  })
  if (!patches.length) return
  logger.info('应用画布整理', { event: 'canvas.tidy.apply.start', projectId: draft.projectId, count: patches.length })
  try {
    await applyCanvasNodePropertyPatches(draft.projectId, patches)
    logger.info('画布整理已保存', { event: 'canvas.tidy.apply.completed', projectId: draft.projectId, count: patches.length })
  } catch (error) {
    logger.error('画布整理应用失败', error, { event: 'canvas.tidy.apply.failed', projectId: draft.projectId })
    throw error
  }
}
