import { rampVideoEditClipSpeedCapability, rippleVideoEditClipSpeedCapability } from '@/core/application-control/domains/videoEdit/videoEditSpeedCapability'
import { videoEditClipSourceSpanSeconds, videoEditSpeedRatio } from '@/core/videoEdit/clipSpeed'
import { videoEditFps } from '@/core/videoEdit/time'
import { buildVideoEditSpeedRampCurve, videoEditTimeRemapPreset, videoEditTimeRemapSummary } from '@/core/videoEdit/timeRemapRamps'
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

/**
 * 速度坡道（时间重映射的算法能力）：按时刻/节拍生成速度曲线，再走与界面同一个时间线速度编辑（`kind: 'speed'`，
 * `change.timeRemap`），一次编辑、一次撤销；链接的声音按链接选择一起改。
 */
export async function rampVideoEditClipSpeed(raw: unknown, context: CapabilityExecutionContext) {
  const input = rampVideoEditClipSpeedCapability.inputSchema.parse(raw)
  const id = input.documentRef.id; const owner = requireVideoEditInstance(id)
  const value = splitVideoEditRef(input.clipRef)
  if (value.projectId !== id || !value.childId) throw new Error('clipRef 必须属于目标剪辑，请使用目录返回的完整引用。')
  const sequence = owner.document.sequences.find(entry => entry.clips.some(clip => clip.id === value.childId))
  const clip = sequence?.clips.find(entry => entry.id === value.childId)
  if (!sequence || !clip) throw new Error('clipRef 不是现有片段，请列出 video_edit.clip 后重试。')
  const fps = videoEditFps(sequence.frameRate)
  const markers = (sequence.markers ?? []).filter(marker => input.snap === 'marker' || marker.type === 'beat').map(marker => marker.frame / fps)
  if (input.snap && input.snap !== 'none' && input.ramps?.length && !markers.length) throw new Error(input.snap === 'beat' ? '序列里还没有节拍标记：先用 analyze_video_edit_beats 生成节拍，或改用 snap=none。' : '序列里没有标记，请改用 snap=none。')
  const snap = (seconds: number): number => !input.snap || input.snap === 'none' ? seconds : markers.reduce((best, at) => Math.abs(at - seconds) < Math.abs(best - seconds) ? at : best, markers[0])
  const ramps = (input.ramps ?? []).map(ramp => ({ atSeconds: snap(ramp.atSeconds), speed: ramp.speedPercent / 100, holdSeconds: ramp.holdSeconds ?? 0, easeInSeconds: ramp.easeInSeconds ?? .3, easeOutSeconds: ramp.easeOutSeconds ?? ramp.easeInSeconds ?? .3 }))
  const outside = ramps.find(ramp => ramp.atSeconds < clip.start / fps || ramp.atSeconds >= (clip.start + clip.duration) / fps)
  if (outside) throw new Error(`坡道时刻 ${outside.atSeconds.toFixed(3)} 秒不在片段范围内（${(clip.start / fps).toFixed(3)}–${((clip.start + clip.duration) / fps).toFixed(3)} 秒）。`)
  const curve = input.preset ? videoEditTimeRemapPreset(input.preset, videoEditClipSourceSpanSeconds(clip, fps)) : buildVideoEditSpeedRampCurve(clip, fps, ramps, (input.baseSpeedPercent ?? 100) / 100)
  const frameInterpolation = input.frameInterpolation ?? (curve.points.some(point => point.speed < 1) ? 'blend' : undefined)
  const view = owner.activeSequenceId === sequence.id ? owner : owner.sequenceViews.get(sequence.id)
  context.signal?.throwIfAborted()
  const result = executeVideoEditTimelineEdit(id, sequence.id, { kind: 'speed', clipIds: [clip.id],
    linked: input.linked === false ? false : videoEditPickRelations(view?.linkedSelection !== false),
    change: { ripple: input.ripple !== false, timeRemap: curve, ...(frameInterpolation ? { frameInterpolation } : {}) },
  })
  const document = owner.document
  const changedClipRefs = result.clips.filter(entry => JSON.stringify(sequence.clips.find(before => before.id === entry.id)) !== JSON.stringify(entry))
    .map(entry => ({ kind: 'video_edit.clip' as const, id: `${id}:${entry.id}` }))
  const written = result.clips.find(entry => entry.id === clip.id)!
  await saveVideoEdit(id)
  const verified = requireVideoEditInstance(id) === owner && await verifyVideoEditSaved(id, document)
  return { resultRef: input.documentRef, changedClipRefs, durationFrames: written.duration, curve: videoEditTimeRemapSummary(written.timeRemap ?? curve), snappedSeconds: ramps.map(ramp => ramp.atSeconds),
    message: `已给片段加上速度曲线，时长 ${(clip.duration / fps).toFixed(2)} → ${(written.duration / fps).toFixed(2)} 秒，可一步撤销。`,
    verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读并核对速度曲线及后续片段的完整编辑。' },
  }
}
