import { videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import type { SpatialPropagationRequest } from '@/core/videoEdit/spatialTypes'
import { planVideoEditSpatialPropagationOffThread } from './videoEditMotionWorkerClient'

export interface VideoEditSpatialEditOptions {
  signal: AbortSignal
  operation?: SpatialPropagationRequest['operation']
  clipMap?: SpatialPropagationRequest['clipMap']
  sequenceTimeMap?: SpatialPropagationRequest['sequenceTimeMap']
}

/** 整份文档只规划一次，跨序列目标与时钟映射共用原快照，提交前不发布中间状态。 */
export async function propagateVideoEditSpatialFields(before: VideoEditDocument, proposed: VideoEditDocument, signal: AbortSignal, options: Omit<VideoEditSpatialEditOptions, 'signal'> = {}): Promise<VideoEditDocument> {
  signal.throwIfAborted()
  const sequence = proposed.sequences.find(next => next.spatialCamera && before.sequences.some(previous => previous.id === next.id))
  if (!sequence) return proposed
  const clipMap = [...(options.clipMap ?? []), ...before.sequences.flatMap(previous => previous.clips.flatMap(clip => {
    const next = proposed.sequences.find(value => value.clips.some(candidate => candidate.id === clip.id))
    return next?.id === previous.id ? [] : [{ fromSequenceId: previous.id, fromClipId: clip.id, sourceRange: [clip.start, clip.start + clip.duration] as const, toSequenceId: next?.id ?? previous.id, toClipId: next ? clip.id : null }]
  }))]
  const base = videoEditComposition(before, sequence.id)
  const result = await planVideoEditSpatialPropagationOffThread({
    before: { composition: base, sequenceId: sequence.id, revision: before.revision }, proposed: videoEditComposition(proposed, sequence.id),
    operation: options.operation ?? (clipMap.length ? 'delete' : 'fields'), clipMap, sequenceTimeMap: options.sequenceTimeMap ?? [],
    output: { width: sequence.width, height: sequence.height, displayWidth: sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator, displayHeight: sequence.height }, quality: 'final', signal,
  })
  signal.throwIfAborted()
  return { ...proposed, sequences: (result.composition.sequences ?? proposed.sequences).map(value => value.id === result.composition.id ? { ...value, clips: result.composition.clips, spatialCamera: result.composition.spatialCamera } : value) }
}
