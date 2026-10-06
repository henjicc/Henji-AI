import type { VideoEditCommandScope } from '@/core/videoEdit/commands'
import { videoEditMatchFrameTarget, videoEditReverseMatchFrame, type VideoEditReverseMatchTarget } from '@/core/videoEdit/matchFrame'
import { focusVideoEditPanel, getActiveVideoEditSequence, requireVideoEditInstance, setVideoEditView, type VideoEditInstance } from './videoEditService'
import { readVideoEditSource, updateVideoEditSource } from './videoEditSource'

/** 匹配帧（F）与反向匹配帧（Shift+R）：落点由 core/videoEdit/matchFrame 计算，这里接到源监视器与节目播放头。 */
function targetTracks(owner: VideoEditInstance): number[] {
  const sequence = getActiveVideoEditSequence(owner)
  return sequence.tracks.filter(track => owner.targetTrackIds.includes(track.id)).map(track => track.index)
}
function sourceFrame(owner: VideoEditInstance): { itemId: string; timeUs: number } | { reason: string } {
  const source = readVideoEditSource(owner.document.id)
  if (!source.itemId || source.status === 'closed') return { reason: '请先在源监视器打开素材。' }
  const media = owner.document.media.find(media => media.id === owner.document.items.find(item => item.id === source.itemId)?.mediaId)
  return { itemId: source.itemId, timeUs: media?.kind === 'video' ? source.presentedTimeUs : source.timeUs }
}
function reverseTarget(owner: VideoEditInstance): VideoEditReverseMatchTarget | { reason: string } {
  const source = sourceFrame(owner)
  if ('reason' in source) return source
  return videoEditReverseMatchFrame(getActiveVideoEditSequence(owner), { ...source, frame: owner.frame, targetTracks: targetTracks(owner) })
}
/** 命令不可用的原因；可用时返回 undefined。 */
export function videoEditMatchFrameUnavailable(owner: VideoEditInstance, id: 'match_frame' | 'reverse_match_frame', clipIds: readonly string[], frame: number, scope: VideoEditCommandScope): string | undefined {
  if (id === 'reverse_match_frame') { const target = reverseTarget(owner); return 'reason' in target ? target.reason : undefined }
  if (scope === 'source') return '请在时间线或节目监视器中使用。'
  const target = videoEditMatchFrameTarget(owner.document, getActiveVideoEditSequence(owner), { clipIds, frame, targetTracks: targetTracks(owner) })
  return 'reason' in target ? target.reason : undefined
}
export async function matchVideoEditFrame(projectId: string, clipIds: readonly string[], frame: number): Promise<void> {
  const owner = requireVideoEditInstance(projectId)
  const target = videoEditMatchFrameTarget(owner.document, getActiveVideoEditSequence(owner), { clipIds, frame, targetTracks: targetTracks(owner) })
  if ('reason' in target) throw new Error(target.reason)
  await updateVideoEditSource(projectId, { itemId: target.itemId, timeUs: target.timeUs, inUs: target.inUs, outUs: target.outUs, playing: false })
  focusVideoEditPanel(projectId, 'source')
}
export function reverseMatchVideoEditFrame(projectId: string): void {
  const owner = requireVideoEditInstance(projectId)
  const target = reverseTarget(owner)
  if ('reason' in target) throw new Error(target.reason)
  setVideoEditView(projectId, { frame: target.frame, playing: false })
  focusVideoEditPanel(projectId, 'timeline')
}
