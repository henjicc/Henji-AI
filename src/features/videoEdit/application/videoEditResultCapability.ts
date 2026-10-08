import type { z } from 'zod'
import type { placeVideoEditCreativeResultCapability } from '@/core/application-control/domains/videoEdit/videoEditApplicationCapabilities'
import type { VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import { videoEditResultPlacementSchema } from '@/core/videoEdit/creativeResult'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { splitVideoEditRef } from './videoEditReflection'
import { captureVideoEditResultTarget, readVideoEditResultPlacement } from './videoEditResultTarget'
import { readVideoEditImageReturn } from './videoEditFrameEdit'
import { createVideoEditCreativeTransfer, runVideoEditCreativeTransfer } from './videoEditCreativeTransfer'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'

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
  if (source.type === 'asset') return { type: 'asset', assetId: source.assetRef.id }
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
export async function placeVideoEditCreativeResultFromCapability(input: PlaceInput, signal?: AbortSignal, operationId?: string): Promise<PlaceOutput> {
  let dispatched = false
  try {
  const projectId = input.documentRef.id
  const sequenceId = childOf(projectId, input.sequenceRef)
  const placement = videoEditResultPlacementSchema.parse(input.placement.mode === 'library' ? { mode: 'library' as const }
    : input.placement.mode === 'replace' ? { mode: 'replace' as const, clipId: childOf(projectId, input.placement.clipRef) }
    : { mode: input.placement.mode, frame: input.placement.frame, ...(input.placement.trackRef ? { trackId: childOf(projectId, input.placement.trackRef) } : {}), ...(input.placement.mode === 'add' && input.placement.newTrack ? { newTrack: input.placement.newTrack } : {}), ...(input.placement.durationFrames !== undefined ? { duration: input.placement.durationFrames } : {}) })
  const bound = input.frameEditSessionRef ? readVideoEditImageReturn(input.frameEditSessionRef) : undefined
  if (input.frameEditSessionRef && (!bound || bound.target.projectId !== projectId || bound.target.sequenceId !== sequenceId || JSON.stringify(videoEditResultPlacementSchema.parse(readVideoEditResultPlacement(bound.target))) !== JSON.stringify(placement))) throw new Error('原帧编辑会话或回填位置已失效，请重新打开当前帧。')
  const target = bound?.target ?? captureVideoEditResultTarget(projectId, sequenceId, placement)
  const transfer = createVideoEditCreativeTransfer(target, await sourceRequest(input.result))
  dispatched = true
  const receipt = await runVideoEditCreativeTransfer(transfer, signal, operationId)
  const resultRef = receipt.clipId ? { kind: 'video_edit.clip' as const, id: `${projectId}:${receipt.clipId}` } : { kind: 'video_edit.item' as const, id: `${projectId}:${receipt.itemId}` }
  return {
    resultRef, documentRef: input.documentRef, assetRef: { kind: 'asset', id: receipt.assetId },
    message: placement.mode === 'library' ? '创作结果已加入素材面板并保存，可一次撤销。' : '创作结果已按指定方式加入剪辑并保存，可一次撤销恢复。',
    verification: { verified: receipt.verified, target: resultRef, condition: '已从剪辑文件回读并核对素材或片段与资产内容身份。' },
  }
  } catch (error) {
    if (!dispatched) throw new ApplicationPreflightFailure(error)
    throw error
  }
}
