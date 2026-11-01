import { retryVideoEditSmartRegionCapability } from '@/core/application-control/domains/videoEdit/videoEditSmartRegionCapability'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance } from './videoEditService'
import { retryVideoEditSmartRegion, videoEditEffectRegionStatuses } from './videoEditSmartRegions'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'

export function retryVideoEditSmartRegionFromCapability(raw: unknown, signal: AbortSignal) {
  const input = retryVideoEditSmartRegionCapability.inputSchema.parse(raw)
  const owner = requireVideoEditInstance(input.documentRef.id)
  const ref = splitVideoEditRef(input.effectRef)
  const sequence = owner.document.sequences.find(sequence => sequence.clips.some(clip => clip.effects?.some(effect => effect.id === ref.childId)))
  const clip = sequence?.clips.find(clip => clip.effects?.some(effect => effect.id === ref.childId))
  const effect = clip?.effects?.find(effect => effect.id === ref.childId)
  if (ref.projectId !== input.documentRef.id || !sequence || !clip || !effect) throw new ApplicationPreflightFailure('effectRef 必须引用目标剪辑中现有的效果。请列出 video_edit.effect 后使用完整引用。')
  // 作用区域与人物蒙版（主体抠像、轮廓来源为主体）用同一套分析，一起重试。
  const regions = videoEditEffectRegionStatuses(owner.document, sequence.frameRate, clip, effect)
  if (!regions.length) throw new ApplicationPreflightFailure('这个效果没有可重试的智能区域，请读取 mask 与 region_status。手绘遮罩或跟踪器不使用智能区域分析。')
  if (regions.every(({ status }) => status.state === 'ready')) throw new ApplicationPreflightFailure('这个智能区域已经完成，无需重试。')
  signal.throwIfAborted()
  for (const { request, status } of regions) if (status.state === 'failed') retryVideoEditSmartRegion(request)
  const current = videoEditEffectRegionStatuses(owner.document, sequence.frameRate, clip, effect)
  return { resultRef: input.effectRef, status: 'analyzing' as const, verified: current.every(({ status }) => status.state === 'analyzing' || status.state === 'ready'), message: '已请求重试共享区域分析；读取 effect.region_status 核对完成或失败。' }
}
