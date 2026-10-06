import { rippleVideoEditClipSpeedCapability } from '@/core/application-control/domains/videoEdit/videoEditSpeedCapability'
import { videoEditSpeedRatio } from '@/core/videoEdit/clipSpeed'
import { videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { executeVideoEditTimelineEdit } from './videoEditTimeline'

/** 由时间线正式算法统一计算源时间、链接片段及实际后移量；不在助手适配器手算。 */
export async function rippleVideoEditClipSpeed(raw: unknown, context: CapabilityExecutionContext) {
  const input = rippleVideoEditClipSpeedCapability.inputSchema.parse(raw)
  const id = input.documentRef.id; const owner = requireVideoEditInstance(id)
  const clipIds = [...new Set(input.clipRefs.map(ref => {
    const value = splitVideoEditRef(ref)
    if (value.projectId !== id || !value.childId) throw new Error('clipRefs 必须属于目标剪辑，请使用目录返回的完整引用。')
    return value.childId
  }))]
  const sequence = owner.document.sequences.find(value => value.clips.some(clip => clip.id === clipIds[0]))
  if (!sequence || clipIds.some(id => !sequence.clips.some(clip => clip.id === id))) throw new Error('clipRefs 必须是同一序列的现有片段，请列出 video_edit.clip 后重试。')
  const view = owner.activeSequenceId === sequence.id ? owner : owner.sequenceViews.get(sequence.id)
  context.signal?.throwIfAborted()
  const result = executeVideoEditTimelineEdit(id, sequence.id, { kind: 'speed', clipIds,
    linked: input.linked === false ? false : videoEditPickRelations(input.linked ?? (view?.linkedSelection !== false)),
    change: { ripple: true, ...(input.speedPercent !== undefined ? { speed: videoEditSpeedRatio(input.speedPercent / 100) } : { duration: input.durationFrames }),
      ...(input.reverse !== undefined ? { reverse: input.reverse } : {}), ...(input.preservePitch !== undefined ? { preservePitch: input.preservePitch } : {}),
    },
  })
  const document = owner.document
  const changedClipRefs = result.clips.filter(clip => JSON.stringify(sequence.clips.find(before => before.id === clip.id)) !== JSON.stringify(clip))
    .map(clip => ({ kind: 'video_edit.clip' as const, id: `${id}:${clip.id}` }))
  await saveVideoEdit(id)
  const verified = requireVideoEditInstance(id) === owner && await verifyVideoEditSaved(id, document)
  return { resultRef: input.documentRef, changedClipRefs, message: '已改变片段速度并按实际时长波纹调整后续片段，可一步撤销。',
    verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读并核对变速及后续片段的完整编辑。' },
  }
}
