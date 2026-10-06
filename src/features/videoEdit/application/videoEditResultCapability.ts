import type { z } from 'zod'
import type { placeVideoEditCreativeResultCapability } from '@/core/application-control/domains/videoEdit/videoEditApplicationCapabilities'
import type { VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { splitVideoEditRef } from './videoEditReflection'
import { captureVideoEditResultTarget } from './videoEditResultTarget'
import { createVideoEditCreativeTransfer, runVideoEditCreativeTransfer } from './videoEditCreativeTransfer'

type PlaceInput = z.infer<typeof placeVideoEditCreativeResultCapability.inputSchema>
type PlaceOutput = z.infer<typeof placeVideoEditCreativeResultCapability.outputSchema>

function childOf(projectId: string, ref: { kind: string; id: string }): string {
  const value = splitVideoEditRef(ref)
  if (value.projectId !== projectId || !value.childId) throw new Error(`${ref.kind} 必须属于目标剪辑，请使用目录返回的完整引用。`)
  return value.childId
}
/** 公共入口只把引用换成来源（文档引用补上当前位置），之后与界面同一条放入流程。 */
async function sourceRequest(source: PlaceInput['result']): Promise<VideoEditCreativeSourceRequest> {
  if (source.type === 'generation') return { type: 'generation', recordId: source.resultRef.id, outputIndex: source.outputIndex }
  const document = await getDocumentOperations().findDocument(source.documentRef.id)
  let part: string | undefined
  if (source.nodeRef) {
    const prefix = `${document.id}:`
    if (!source.nodeRef.id.startsWith(prefix) || source.nodeRef.id.length === prefix.length) throw new Error(`nodeRef 必须是这份画布里的节点，格式为 ${prefix}<节点 ID>。`)
    part = source.nodeRef.id.slice(prefix.length)
  }
  return { type: 'document', docRef: { docId: document.id, path: document.path }, ...(part ? { part } : {}), ...(source.includeProcessing !== undefined ? { includeProcessing: source.includeProcessing } : {}) }
}

/** Same frozen-target transfer as the UI send menus; the public layer only maps refs. */
export async function placeVideoEditCreativeResultFromCapability(input: PlaceInput, signal?: AbortSignal): Promise<PlaceOutput> {
  const projectId = input.documentRef.id
  const sequenceId = childOf(projectId, input.sequenceRef)
  const placement = input.placement.mode === 'add'
    ? { mode: 'add' as const, frame: input.placement.frame, trackId: childOf(projectId, input.placement.trackRef), ...(input.placement.durationFrames !== undefined ? { duration: input.placement.durationFrames } : {}) }
    : { mode: 'replace' as const, clipId: childOf(projectId, input.placement.clipRef) }
  const target = captureVideoEditResultTarget(projectId, sequenceId, placement)
  const receipt = await runVideoEditCreativeTransfer(createVideoEditCreativeTransfer(target, await sourceRequest(input.result)), signal)
  const resultRef = { kind: 'video_edit.clip' as const, id: `${projectId}:${receipt.clipId}` }
  return {
    resultRef, documentRef: input.documentRef, assetRef: { kind: 'asset', id: receipt.assetId },
    message: placement.mode === 'replace' ? '创作结果已替换原片段并保存，可一次撤销恢复。' : '创作结果已加入指定轨道并保存，可一次撤销移除。',
    verification: { verified: receipt.verified, target: resultRef, condition: '已从剪辑文件回读并核对该片段、来源与资产内容身份。' },
  }
}
