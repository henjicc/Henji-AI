import { editVideoEditFrameCapability, sendVideoEditToCanvasCapability } from '@/core/application-control/domains/videoEdit/videoEditWorkspaceTransferCapabilities'
import { useImageEditorHandoffStore } from '@/features/imageEdit/store/imageEditorHandoffStore'
import { sendVideoEditToCanvas } from '@/services/workspaceTransfer'
import { splitVideoEditRef } from './videoEditReflection'
import { editVideoEditProgramFrame, readVideoEditImageReturn } from './videoEditFrameEdit'
import { readVideoEditResultPlacement } from './videoEditResultTarget'

function childOf(projectId: string, ref: { kind: string; id: string }): string {
  const parsed = splitVideoEditRef(ref)
  if (parsed.projectId !== projectId || !parsed.childId) throw new Error(`${ref.kind} 必须属于来源剪辑，请使用完整引用。`)
  return parsed.childId
}

export async function handleVideoEditWorkspaceTransfer(id: string, raw: unknown, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  if (id === sendVideoEditToCanvasCapability.id) {
    const input = sendVideoEditToCanvasCapability.inputSchema.parse(raw)
    const receipt = await sendVideoEditToCanvas({ projectId: input.documentRef.id, sequenceId: childOf(input.documentRef.id, input.sequenceRef), canvasId: input.canvasRef.id, source: input.selection.kind === 'frame' ? { kind: 'frame', frame: input.selection.frame } : { kind: 'clip', clipId: childOf(input.documentRef.id, input.selection.clipRef) }, placement: input.placement }, signal)
    return { ...receipt, message: '已发送到指定画布并保存，可在画布中撤销。', verification: { ...receipt.verification, target: receipt.nodeRef } }
  }
  if (id === editVideoEditFrameCapability.id) {
    const input = editVideoEditFrameCapability.inputSchema.parse(raw)
    const sessionRef = await editVideoEditProgramFrame(input.documentRef.id, signal)
    const bound = readVideoEditImageReturn(sessionRef ?? undefined)
    if (!bound) throw new Error('当前帧未能交给图片编辑器，请重新打开。')
    const placement = readVideoEditResultPlacement(bound.target)
    if (placement.mode !== 'add') throw new Error('原帧回填位置不可用，请重新打开。')
    return { surfaceRef: { kind: 'application.surface', id: 'tool.image_edit' }, assetRef: bound.assetRef, documentRef: input.documentRef, frameEditSessionRef: sessionRef,
      sequenceRef: { kind: 'video_edit.sequence', id: `${input.documentRef.id}:${bound.target.sequenceId}` },
      returnPlacement: { mode: 'add', frame: placement.frame, durationFrames: 1, ...(placement.trackId ? { trackRef: { kind: 'video_edit.track', id: `${input.documentRef.id}:${placement.trackId}` } } : { newTrack: placement.newTrack }) },
      message: '当前帧已打开图片编辑器，保存后可替换回原位置一帧。', verification: { verified: useImageEditorHandoffStore.getState().pending?.sessionRef === sessionRef, condition: '完整画面已检查为资产，图片编辑器已收到原帧与固定回填位置。' } }
  }
  return null
}
