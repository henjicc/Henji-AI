import { rendererEpoch } from '@/core/application-control/runtimeIdentity'
import type { VideoEditInstance } from './videoEditService'
import { videoEditTrackResults, videoEditTrackingRevision } from './videoEditTracking'
import { codeTextFontGeneration } from '../videoEditGlyphMetrics'

// 不落盘；同一渲染器内重开文档也会取得新的实例代次。
const instanceEpochs = new WeakMap<VideoEditInstance, { epoch: string; tracking: string; generation: number; statusRevision: number; document: VideoEditInstance['document'] }>()

/** 标识实际采样快照；只比较相等性，不跨宿主按数字修订号排序。 */
export function videoEditObservationVersion(owner: VideoEditInstance, revision: number): string {
  const previous = instanceEpochs.get(owner)
  const statusRevision = videoEditTrackingRevision()
  const fonts = codeTextFontGeneration()
  if (previous && previous.document === owner.document && previous.statusRevision === statusRevision) return `${rendererEpoch}:${previous.epoch}:${revision}:${previous.generation}:${fonts}`
  const results: ReturnType<typeof videoEditTrackResults> = {}
  for (const sequence of owner.document.sequences) if (sequence.clips.some(clip => clip.trackers?.length)) Object.assign(results, videoEditTrackResults({ ...owner.document, ...sequence }))
  const tracking = JSON.stringify(Object.keys(results).sort().map(key => [key, results[key]]))
  const current = { epoch: previous?.epoch ?? crypto.randomUUID(), tracking, generation: (previous?.generation ?? 0) + (previous && previous.tracking !== tracking ? 1 : 0), statusRevision, document: owner.document }
  instanceEpochs.set(owner, current)
  return `${rendererEpoch}:${current.epoch}:${revision}:${current.generation}:${fonts}`
}
