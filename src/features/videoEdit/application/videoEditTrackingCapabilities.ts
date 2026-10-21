import { followVideoEditTrackerCapability, stabilizeVideoEditClipCapability, trackVideoEditRecordingCapability } from '@/core/application-control/domains/videoEdit/videoEditTrackingCapabilities'
import { VIDEO_EDIT_STABILIZATION_DEFAULTS, VIDEO_EDIT_STABILIZATION_SMOOTHNESS_LABELS } from '@/core/videoEdit/stabilization'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { videoEditCompositeOwner, videoEditTrackerEntityId } from './videoEditCompositeEntities'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { setVideoEditClipStabilization, waitVideoEditStabilization } from './videoEditStabilization'
import { bakeVideoEditClipFollow, bindVideoEditTracking, createVideoEditRecordingTracker } from './videoEditTrackingEdits'
import { videoEditTrackingRequest, waitVideoEditTrackingDefinitions } from './videoEditTracking'

/* 跟踪与防抖算法能力的执行器：只委托界面同用的正式领域函数，读回剪辑文件核对结果。 */

function clipInDocument(documentId: string, ref: { kind: string; id: string }): { sequenceId: string; clipId: string } {
  const { projectId, childId } = splitVideoEditRef(ref)
  if (projectId !== documentId || !childId) throw new Error('clipRef 必须属于目标剪辑，请使用 video_edit.clip 目录返回的完整引用。')
  const sequence = requireVideoEditInstance(documentId).document.sequences.find(entry => entry.clips.some(clip => clip.id === childId))
  if (!sequence) throw new Error('NOT_FOUND：片段已移除，请重新列出 video_edit.clip。')
  return { sequenceId: sequence.id, clipId: childId }
}

async function saved(documentId: string): Promise<boolean> {
  const owner = requireVideoEditInstance(documentId); const document = owner.document
  await saveVideoEdit(documentId)
  return requireVideoEditInstance(documentId) === owner && await verifyVideoEditSaved(documentId, document)
}

export async function followVideoEditTrackerFromCapability(raw: unknown, context: CapabilityExecutionContext) {
  const input = followVideoEditTrackerCapability.inputSchema.parse(raw)
  const id = input.documentRef.id; const instance = requireVideoEditInstance(id)
  const follower = clipInDocument(id, input.clipRef)
  const tracker = splitVideoEditRef(input.trackerRef)
  if (tracker.projectId !== id) throw new Error('trackerRef 必须属于目标剪辑。')
  const owner = videoEditCompositeOwner(instance.document, 'video_edit.tracker', tracker.childId)
  if (owner.kind !== 'tracker') throw new Error('trackerRef 不是跟踪器。')
  if (owner.sequence.id !== follower.sequenceId) throw new Error('跟随片段与跟踪器所在片段必须在同一序列。')
  if (owner.clip.id === follower.clipId) throw new Error('片段不能跟随自己身上的跟踪器；请选择另一个片段。')
  const clip = owner.sequence.clips.find(entry => entry.id === follower.clipId)!
  // 绑定前等跟踪覆盖被跟踪片段，避免在还没跟到的帧上建立偏移。
  const request = videoEditTrackingRequest(instance.document, owner.sequence.frameRate, owner.clip, owner.tracker)
  if (request && !request.definition.recording) await waitVideoEditTrackingDefinitions([request], context.signal)
  context.signal?.throwIfAborted()
  const options = input.follow ?? {}
  await bindVideoEditTracking(id, follower.sequenceId, owner.clip.id, owner.tracker.id, { clipId: follower.clipId, scale: Boolean(options.scale), rotation: Boolean(options.rotation), cornerPin: Boolean(options.cornerPin) }, input.frame ?? clip.start)
  const keyframes = input.apply === 'keyframes' ? (await bakeVideoEditClipFollow(id, follower.sequenceId, follower.clipId, context.signal)).keyframes : undefined
  const after = requireVideoEditInstance(id).document.sequences.find(entry => entry.id === follower.sequenceId)?.clips.find(entry => entry.id === follower.clipId)
  const verified = await saved(id) && (keyframes ? !after?.follow : after?.follow?.trackerId === owner.tracker.id)
  const parts = [options.rotation && '旋转', options.scale && '缩放', options.cornerPin && '四角'].filter(Boolean).join('、')
  return {
    resultRef: input.clipRef, follow: after?.follow ? { ...after.follow } : null, ...(keyframes ? { keyframes } : {}),
    message: keyframes ? `已把跟踪写成关键帧（位置 ${keyframes.x}/${keyframes.y}、缩放 ${keyframes.scale}、旋转 ${keyframes.rotation} 个），并去掉跟随绑定，可一步撤销。` : `已让片段跟随“${owner.tracker.name}”的位置${parts ? `与${parts}` : ''}，跟踪重算或纠错后自动更新。`,
    verification: { verified, target: input.clipRef, condition: keyframes ? '已从剪辑文件回读：跟随已去掉，位置、缩放、旋转关键帧已写入。' : '已从剪辑文件回读并核对跟随绑定。' },
  }
}

export async function stabilizeVideoEditClipFromCapability(raw: unknown, context: CapabilityExecutionContext) {
  const input = stabilizeVideoEditClipCapability.inputSchema.parse(raw)
  const id = input.documentRef.id
  const { sequenceId, clipId } = clipInDocument(id, input.clipRef)
  const current = requireVideoEditInstance(id).document.sequences.find(entry => entry.id === sequenceId)!.clips.find(entry => entry.id === clipId)!
  const base = current.stabilization ?? VIDEO_EDIT_STABILIZATION_DEFAULTS
  const stabilization = { smoothness: input.smoothness ?? base.smoothness, maxCrop: input.maxCrop ?? base.maxCrop, rotation: input.rotation ?? base.rotation, scale: input.scale ?? base.scale }
  setVideoEditClipStabilization(id, sequenceId, clipId, stabilization)
  const verified = await saved(id)
  const readout = await waitVideoEditStabilization(id, sequenceId, clipId, context.signal)
  if (readout.state === 'failed') throw new Error(`防抖分析失败：${readout.message}（参数已保存，可修改后重试或写 null 关闭）`)
  if (readout.state !== 'ready') throw new Error('防抖分析还没有完成，请稍后用 video_edit.clip.stabilization 读回或重新调用。')
  const percent = Math.round(readout.crop * 1000) / 10
  return {
    resultRef: input.clipRef, stabilization, crop: readout.crop, analyzedFrames: readout.frames,
    message: `已按“${VIDEO_EDIT_STABILIZATION_SMOOTHNESS_LABELS[stabilization.smoothness]}”防抖：分析 ${readout.frames} 帧，实际裁切 ${percent}%（上限 ${Math.round(stabilization.maxCrop * 100)}%）${stabilization.rotation ? '' : '，不校正旋转'}${stabilization.scale ? '' : '，不校正缩放'}；可一步撤销。`,
    verification: { verified, target: input.clipRef, condition: '已从剪辑文件回读防抖参数，并求出覆盖片段的平滑路径与裁切比例。' },
  }
}

export async function trackVideoEditRecordingFromCapability(raw: unknown, context: CapabilityExecutionContext) {
  const input = trackVideoEditRecordingCapability.inputSchema.parse(raw)
  const id = input.documentRef.id
  const { sequenceId, clipId } = clipInDocument(id, input.clipRef)
  const tracker = await createVideoEditRecordingTracker(id, sequenceId, clipId, { kind: input.target, ...(input.frame !== undefined ? { frame: input.frame } : {}), ...(input.region ? { region: input.region } : {}), ...(input.size !== undefined ? { size: input.size } : {}), ...(input.name ? { name: input.name } : {}) }, context.signal)
  const verified = await saved(id)
  const resultRef = { kind: 'video_edit.tracker' as const, id: `${id}:${videoEditTrackerEntityId(clipId, tracker.id)}` }
  return {
    resultRef, clipRef: input.clipRef,
    message: input.target === 'cursor' ? `已建立光标跟踪“${tracker.name}”，结果直接来自录制事件；用 follow_video_edit_tracker 让标注跟随，或作为效果作用区域。` : `已建立窗口跟踪“${tracker.name}”，区域随窗口移动、缩放；可作为马赛克、模糊等效果的作用区域（mask regionId:tracker）。`,
    verification: { verified, target: resultRef, condition: '已从剪辑文件回读新跟踪器。' },
  }
}
