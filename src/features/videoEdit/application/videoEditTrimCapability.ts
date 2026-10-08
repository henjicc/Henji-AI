import type { z } from 'zod'
import type { trimVideoEditClipCapability } from '@/core/application-control/domains/videoEdit/videoEditApplicationCapabilities'
import { applyVideoEditTrim, videoEditTrimAvailability } from '@/core/videoEdit/timelineTrims'
import { VideoEditOperationFailure } from '@/core/videoEdit/operationFailure'
import { expandVideoEditSelection, videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { executeVideoEditTimelineEdit } from './videoEditTimeline'

type TrimInput = z.infer<typeof trimVideoEditClipCapability.inputSchema>
const MODE_NAMES = { ripple: '波纹编辑', roll: '滚动编辑', slip: '外滑', slide: '内滑' } as const

/**
 * 助手的修剪能力（4.6）：与时间线修剪工具同一份编辑（timelineEdits 的 trim），链接片段按当前链接选择一起修剪；
 * 先算出实际能做到的帧数，做不到时说明原因，不写空历史。
 */
export async function trimVideoEditClip(input: TrimInput) {
  const id = input.documentRef.id
  const ref = splitVideoEditRef(input.clipRef)
  const owner = requireVideoEditInstance(id)
  const availableRefs = owner.document.sequences.flatMap(sequence => sequence.clips.map(clip => ({ kind: 'video_edit.clip', id: `${id}:${clip.id}` })))
  const missing = (): VideoEditOperationFailure => new VideoEditOperationFailure(`请使用目标剪辑当前可用的片段引用：${availableRefs.map(ref => ref.id).join('、') || '无'}。`, { reason: 'reference_missing', availableRefs })
  if (ref.projectId !== id || !ref.childId) throw missing()
  const sequence = owner.document.sequences.find(value => value.clips.some(clip => clip.id === ref.childId))
  if (!sequence) throw missing()
  const view = owner.activeSequenceId === sequence.id ? owner : owner.sequenceViews.get(sequence.id)
  const linked = videoEditPickRelations(view?.linkedSelection !== false)
  const trim = { mode: input.mode, ...(input.edge ? { edge: input.edge } : {}), delta: input.frames }
  const result = applyVideoEditTrim(owner.document, sequence.id, { ...trim, clipIds: expandVideoEditSelection(sequence, [ref.childId], linked) }, readVideoEditCodeMetadata(owner, owner.document))
  if (!result.delta) {
    const availability = videoEditTrimAvailability(owner.document, sequence.id, { ...trim, clipIds: expandVideoEditSelection(sequence, [ref.childId], linked) }, readVideoEditCodeMetadata(owner, owner.document))
    throw new VideoEditOperationFailure(`${MODE_NAMES[input.mode]}已到边界；负方向可用 ${availability.negative.frames} 帧，正方向可用 ${availability.positive.frames} 帧，请按余量调整。`, { reason: 'trim_boundary', mode: input.mode, requestedFrames: input.frames, ...availability })
  }
  executeVideoEditTimelineEdit(id, sequence.id, { kind: 'trim', ...trim, clipIds: [ref.childId], linked })
  await saveVideoEdit(id)
  const verified = await verifyVideoEditSaved(id, requireVideoEditInstance(id).document)
  const clamped = result.delta !== input.frames ? `（请求 ${input.frames} 帧，受素材余量或相邻片段限制）` : ''
  return {
    resultRef: input.documentRef,
    message: `已${MODE_NAMES[input.mode]} ${result.delta} 帧${clamped}，可一步撤销。`,
    verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读并核对修剪后的片段。' },
  }
}
