import type { z } from 'zod'
import type { placeVideoEditCreativeResultCapability } from '@/core/application-control/domains/videoEdit/videoEditApplicationCapabilities'
import type { VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import { splitImageEditV3DocumentRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'
import { splitVideoEditRef } from './videoEditReflection'
import { captureVideoEditResultTarget } from './videoEditResultTarget'
import { createVideoEditCreativeTransfer, runVideoEditCreativeTransfer } from './videoEditCreativeTransfer'

type PlaceInput = z.infer<typeof placeVideoEditCreativeResultCapability.inputSchema>
type PlaceOutput = z.infer<typeof placeVideoEditCreativeResultCapability.outputSchema>

function childOf(projectId: string, ref: { kind: string; id: string }): string {
  const value = splitVideoEditRef(ref)
  if (value.projectId !== projectId || !value.childId) throw new Error(`${ref.kind} 必须属于目标剪辑工程，请使用目录返回的完整引用。`)
  return value.childId
}
function sourceRequest(source: PlaceInput['result']): VideoEditCreativeSourceRequest {
  switch (source.kind) {
    case 'generation.result': return { kind: source.kind, id: source.resultRef.id, outputIndex: source.outputIndex }
    case 'canvas.node': return { kind: source.kind, projectId: source.canvasProjectRef.id, nodeId: source.nodeRef.id }
    case 'image_edit.document': return { kind: source.kind, documentRef: `image-edit-v3:${splitImageEditV3DocumentRef(source.documentRef).documentId}`, revision: source.revision }
    case 'audio_edit.project': return { kind: source.kind, projectId: source.audioProjectRef.id, ...(source.includeProcessing !== undefined ? { includeProcessing: source.includeProcessing } : {}) }
    case 'camera_stage.render_task': return { kind: source.kind, taskRef: source.taskRef.id }
  }
}

/** Same frozen-target transfer as the UI send menus; the public layer only maps refs. */
export async function placeVideoEditCreativeResultFromCapability(input: PlaceInput, signal?: AbortSignal): Promise<PlaceOutput> {
  const projectId = input.projectRef.id
  const sequenceId = childOf(projectId, input.sequenceRef)
  const placement = input.placement.mode === 'add'
    ? { mode: 'add' as const, frame: input.placement.frame, trackId: childOf(projectId, input.placement.trackRef), ...(input.placement.durationFrames !== undefined ? { duration: input.placement.durationFrames } : {}) }
    : { mode: 'replace' as const, clipId: childOf(projectId, input.placement.clipRef) }
  const target = captureVideoEditResultTarget(projectId, sequenceId, placement)
  const receipt = await runVideoEditCreativeTransfer(createVideoEditCreativeTransfer(target, sourceRequest(input.result)), signal)
  const resultRef = { kind: 'video_edit.clip' as const, id: `${projectId}:${receipt.clipId}` }
  return {
    resultRef, projectRef: input.projectRef, assetRef: { kind: 'asset', id: receipt.assetId },
    message: placement.mode === 'replace' ? '创作结果已替换原片段并保存，可一次撤销恢复。' : '创作结果已加入指定轨道并保存，可一次撤销移除。',
    verification: { verified: receipt.verified, target: resultRef, condition: '已从工程文件回读并核对该片段、来源与资产内容身份。' },
  }
}
