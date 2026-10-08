import { retryVideoEditSmartRegionCapability } from '@/core/application-control/domains/videoEdit/videoEditSmartRegionCapability'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance } from './videoEditService'
import { retryVideoEditSmartRegion, videoEditSmartRegionRequest, videoEditSmartRegionStatus } from './videoEditSmartRegions'

export function retryVideoEditSmartRegionFromCapability(raw: unknown, signal: AbortSignal) {
  const input = retryVideoEditSmartRegionCapability.inputSchema.parse(raw)
  const owner = requireVideoEditInstance(input.documentRef.id)
  const ref = splitVideoEditRef(input.effectRef)
  const sequence = owner.document.sequences.find(sequence => sequence.clips.some(clip => clip.effects?.some(effect => effect.id === ref.childId)))
  const clip = sequence?.clips.find(clip => clip.effects?.some(effect => effect.id === ref.childId))
  const effect = clip?.effects?.find(effect => effect.id === ref.childId)
  if (ref.projectId !== input.documentRef.id || !sequence || !clip || !effect) throw new Error('effectRef 必须引用目标剪辑中现有的效果。请列出 video_edit.effect 后使用完整引用。')
  const request = videoEditSmartRegionRequest(owner.document, sequence.frameRate, clip, effect)
  if (!request) throw new Error('这个效果没有可重试的智能区域，请读取 mask 与 region_status。手绘遮罩或跟踪器不使用智能区域分析。')
  const status = videoEditSmartRegionStatus(owner.document, sequence.frameRate, clip, effect)
  if (status?.state !== 'failed' && status?.state !== 'analyzing') throw new Error('这个智能区域已经完成，无需重试。')
  signal.throwIfAborted()
  if (status?.state === 'failed') retryVideoEditSmartRegion(request)
  return { resultRef: input.effectRef, status: 'analyzing' as const, message: '已请求重试共享区域分析；读取 effect.region_status 核对完成或失败。' }
}
