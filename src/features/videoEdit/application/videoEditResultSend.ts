import type { VideoEditCreativeSourceRequest } from '@/core/videoEdit/creativeResult'
import { videoEditFps } from '@/core/videoEdit/time'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { videoEditEdgeTracks } from '@/core/videoEdit/tracks'
import { activeVideoEditInstance, getActiveVideoEditSequence, listVideoEditInstances, type VideoEditInstance } from './videoEditService'
import { captureVideoEditResultTarget, type VideoEditResultReceipt, type VideoEditResultTarget } from './videoEditResultTarget'
import { createVideoEditCreativeTransfer, runVideoEditCreativeTransfer } from './videoEditCreativeTransfer'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { openVideoEditDocument } from './videoEditService'

export type VideoEditSendMediaKind = 'image' | 'video' | 'audio'
export type VideoEditSendMode = 'add' | 'replace' | 'library' | 'overwrite' | 'insert'
/** `above` places a still over every picture already visible at the frame (edited program frames). */
export interface VideoEditSendRequest { mediaKind: VideoEditSendMediaKind; mode: VideoEditSendMode; above?: boolean; projectId?: string; duration?: number }
export type VideoEditSendPlan =
  | { available: true; projectId: string; sequenceId: string; label: string; placement: Parameters<typeof captureVideoEditResultTarget>[2] }
  | { available: false; reason: string }

function plan(owner: VideoEditInstance, request: VideoEditSendRequest): VideoEditSendPlan {
  const sequence = getActiveVideoEditSequence(owner); const kind = request.mediaKind === 'audio' ? 'audio' : 'video'
  const where = `${owner.document.name} · ${sequence.name}`
  if (request.mode === 'library') return { available: true, projectId: owner.document.id, sequenceId: sequence.id, label: `加入 ${owner.document.name} 的素材面板`, placement: { mode: 'library' } }
  if (request.mode === 'replace') {
    const clip = sequence.clips.find(clip => clip.id === owner.selection)
    const track = clip && sequence.tracks.find(track => track.index === clip.track)
    if (!clip || !track) return { available: false, reason: '请先在剪辑时间线选择要替换的片段。' }
    if (track.kind !== kind || clip.kind === 'adjustment') return { available: false, reason: kind === 'audio' ? '所选片段不是声音片段，不能用声音替换。' : '所选片段不是画面片段，不能用图片或视频替换。' }
    if (track.locked) return { available: false, reason: '所选片段所在轨道已锁定。' }
    return { available: true, projectId: owner.document.id, sequenceId: sequence.id, label: `替换 ${where} 的「${clip.name}」`, placement: { mode: 'replace', clipId: clip.id } }
  }
  const frame = owner.frame
  if (request.mode === 'overwrite' || request.mode === 'insert') {
    const candidates = sequence.tracks.filter(track => track.kind === kind && !track.locked).sort((a, b) => a.index - b.index)
    const track = candidates.find(track => owner.targetTrackIds.includes(track.id)) ?? candidates[0]
    if (!track) return { available: false, reason: '目标剪辑没有可写入的对应轨道，请先解锁或添加轨道。' }
    return { available: true, projectId: owner.document.id, sequenceId: sequence.id, label: `${where} · ${track.name} · ${videoEditFrameTimecode(frame, videoEditFps(sequence.frameRate))}`, placement: { mode: request.mode, frame, trackId: track.id, ...(request.duration !== undefined ? { duration: request.duration } : {}) } }
  }
  const covers = (index: number): boolean => sequence.clips.some(clip => clip.track === index && clip.start <= frame && clip.start + clip.duration > frame)
  const free = sequence.tracks.filter(track => track.kind === kind && !track.locked && !covers(track.index))
  const floor = request.above ? Math.max(-1, ...sequence.tracks.filter(track => track.kind === 'video' && covers(track.index)).map(track => track.index)) : -1
  const candidates = free.filter(track => track.index > floor).sort((a, b) => a.index - b.index)
  const targeted = candidates.find(track => owner.targetTrackIds.includes(track.id))
  const track = request.above ? candidates[0] : targeted ?? candidates[0]
  if (!track) {
    // 没有空余轨道：与 PR 拖到轨道外一样，在最上面的视频轨之上（或最下面的音频轨之下）新建一条。
    try { videoEditEdgeTracks(sequence, kind, 1) } catch (error) { return { available: false, reason: error instanceof Error ? error.message : String(error) } }
    return { available: true, projectId: owner.document.id, sequenceId: sequence.id, label: `加入 ${where} · 新建${kind === 'audio' ? '音频' : '视频'}轨道 · ${videoEditFrameTimecode(frame, videoEditFps(sequence.frameRate))}`, placement: { mode: 'add', frame, newTrack: kind } }
  }
  return { available: true, projectId: owner.document.id, sequenceId: sequence.id, label: `加入 ${where} · ${track.name} · ${videoEditFrameTimecode(frame, videoEditFps(sequence.frameRate))}`, placement: { mode: 'add', frame, trackId: track.id } }
}

/** Describes where a send would land now; the UI shows this before the user commits. */
export function planVideoEditSend(request: VideoEditSendRequest): VideoEditSendPlan {
  const owner = request.projectId ? listVideoEditInstances().find(owner => owner.document.id === request.projectId) : activeVideoEditInstance()
  return owner ? plan(owner, request) : { available: false, reason: '请先在剪辑工作区打开一个剪辑。' }
}
/** Freezes owner/sequence/placement before any producer work; later focus changes never redirect it. */
export function captureVideoEditSendTarget(request: VideoEditSendRequest, projectId?: string): { target: VideoEditResultTarget; label: string } {
  const id = projectId ?? request.projectId
  const owner = id ? listVideoEditInstances().find(owner => owner.document.id === id) : activeVideoEditInstance()
  if (!owner) throw new Error('原剪辑未打开，请先在剪辑工作区打开剪辑。')
  const value = plan(owner, request)
  if (!value.available) throw new Error(value.reason)
  const placement = value.placement.mode === 'add' && request.duration !== undefined ? { ...value.placement, duration: request.duration } : value.placement
  return { target: captureVideoEditResultTarget(value.projectId, value.sequenceId, placement), label: value.label }
}
export async function sendCreativeResultToVideoEdit(source: VideoEditCreativeSourceRequest | (() => VideoEditCreativeSourceRequest | Promise<VideoEditCreativeSourceRequest>), request: VideoEditSendRequest, signal?: AbortSignal): Promise<VideoEditResultReceipt> {
  const target = captureVideoEditSendTarget(request).target
  const transfer = createVideoEditCreativeTransfer(target, typeof source === 'function' ? await source() : source)
  return await runVideoEditCreativeTransfer(transfer, signal)
}

export async function listVideoEditSendDestinations(): Promise<Array<{ id: string; name: string }>> {
  const documents = await getDocumentOperations().listDocuments({ kind: 'video_edit', includeMissing: false })
  const values = new Map(documents.map(document => [document.id, { id: document.id, name: document.name }]))
  for (const owner of listVideoEditInstances()) values.set(owner.document.id, { id: owner.document.id, name: owner.document.name })
  return [...values.values()]
}
/** Load a chosen destination in the background; selecting it never navigates away from the producer. */
export async function prepareVideoEditSendDestination(projectId: string): Promise<void> {
  await openVideoEditDocument({ id: projectId }, { focus: false })
}
