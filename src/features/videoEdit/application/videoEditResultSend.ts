import type { VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import { videoEditFps } from '@/core/videoEdit/time'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { activeVideoEditInstance, getActiveVideoEditSequence, listVideoEditInstances, type VideoEditInstance } from './videoEditService'
import { captureVideoEditResultTarget, type VideoEditResultReceipt, type VideoEditResultTarget } from './videoEditResultTarget'
import { createVideoEditCreativeTransfer, runVideoEditCreativeTransfer } from './videoEditCreativeTransfer'

export type VideoEditSendMediaKind = 'image' | 'video' | 'audio'
export type VideoEditSendMode = 'add' | 'replace'
/** `above` places a still over every picture already visible at the frame (edited program frames). */
export interface VideoEditSendRequest { mediaKind: VideoEditSendMediaKind; mode: VideoEditSendMode; above?: boolean }
export type VideoEditSendPlan =
  | { available: true; projectId: string; sequenceId: string; label: string; placement: Parameters<typeof captureVideoEditResultTarget>[2] }
  | { available: false; reason: string }

function plan(owner: VideoEditInstance, request: VideoEditSendRequest): VideoEditSendPlan {
  const sequence = getActiveVideoEditSequence(owner); const kind = request.mediaKind === 'audio' ? 'audio' : 'video'
  const where = `${owner.document.name} · ${sequence.name}`
  if (request.mode === 'replace') {
    const clip = sequence.clips.find(clip => clip.id === owner.selection)
    const track = clip && sequence.tracks.find(track => track.index === clip.track)
    if (!clip || !track) return { available: false, reason: '请先在剪辑时间线选择要替换的片段。' }
    if (track.kind !== kind || clip.kind === 'adjustment') return { available: false, reason: kind === 'audio' ? '所选片段不是声音片段，不能用声音替换。' : '所选片段不是画面片段，不能用图片或视频替换。' }
    if (track.locked) return { available: false, reason: '所选片段所在轨道已锁定。' }
    return { available: true, projectId: owner.document.id, sequenceId: sequence.id, label: `替换 ${where} 的「${clip.name}」`, placement: { mode: 'replace', clipId: clip.id } }
  }
  const frame = owner.frame
  const covers = (index: number): boolean => sequence.clips.some(clip => clip.track === index && clip.start <= frame && clip.start + clip.duration > frame)
  const free = sequence.tracks.filter(track => track.kind === kind && !track.locked && !covers(track.index))
  const floor = request.above ? Math.max(-1, ...sequence.tracks.filter(track => track.kind === 'video' && covers(track.index)).map(track => track.index)) : -1
  const candidates = free.filter(track => track.index > floor).sort((a, b) => a.index - b.index)
  const targeted = candidates.find(track => owner.targetTrackIds.includes(track.id))
  const track = request.above ? candidates[0] : targeted ?? candidates[0]
  if (!track) return { available: false, reason: request.above ? '播放头处上方没有空的画面轨道，请先腾出一条上方轨道。' : `播放头处没有空的${kind === 'audio' ? '音频' : '画面'}轨道。` }
  return { available: true, projectId: owner.document.id, sequenceId: sequence.id, label: `加入 ${where} · ${track.name} · ${videoEditFrameTimecode(frame, videoEditFps(sequence.frameRate))}`, placement: { mode: 'add', frame, trackId: track.id } }
}

/** Describes where a send would land now; the UI shows this before the user commits. */
export function planVideoEditSend(request: VideoEditSendRequest): VideoEditSendPlan {
  const owner = activeVideoEditInstance()
  return owner ? plan(owner, request) : { available: false, reason: '请先在剪辑工作区打开一个剪辑。' }
}
/** Freezes owner/sequence/placement before any producer work; later focus changes never redirect it. */
export function captureVideoEditSendTarget(request: VideoEditSendRequest, projectId?: string): { target: VideoEditResultTarget; label: string } {
  const owner = projectId ? listVideoEditInstances().find(owner => owner.document.id === projectId) : activeVideoEditInstance()
  if (!owner) throw new Error('原剪辑未打开，请先在剪辑工作区打开剪辑。')
  const value = plan(owner, request)
  if (!value.available) throw new Error(value.reason)
  return { target: captureVideoEditResultTarget(value.projectId, value.sequenceId, value.placement), label: value.label }
}
export async function sendCreativeResultToVideoEdit(source: VideoEditCreativeSourceRequest, request: VideoEditSendRequest, signal?: AbortSignal): Promise<VideoEditResultReceipt> {
  const transfer = createVideoEditCreativeTransfer(captureVideoEditSendTarget(request).target, source)
  return await runVideoEditCreativeTransfer(transfer, signal)
}
