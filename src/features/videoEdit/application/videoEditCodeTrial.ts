import type { VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditComposition, videoEditVisibleTracks, type VideoEditDocument } from '@/core/videoEdit/document'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { ensureVideoEditCodeDocumentMetadata } from './videoEditCodeState'
import { listVideoEditInstances, subscribeVideoEditDomain, type VideoEditInstance } from './videoEditService'
import { videoEditTransitionWindow } from '@/core/videoEdit/transitions'

export interface VideoEditTrialTarget { sequenceId: string; clipId: string; effectIds?: string[] }
/** Exact original-clock endpoints, plus every affected transition boundary. */
export function videoEditCodeTrialFrames(document: VideoEditDocument, targets: VideoEditTrialTarget[], selected?: { sequenceId: string; frame: number }): Array<{ document: VideoEditComposition; frame: number }> {
  if (!targets.length || targets.length > 32) throw new Error('每次检查1到32个片段。')
  const frames = new Map<string, { document: VideoEditComposition; frame: number }>()
  const compositions = new Map<string, VideoEditComposition>()
  const add = (sequenceId: string, frame: number): void => {
    let composition = compositions.get(sequenceId)
    if (!composition) { composition = videoEditComposition(document, sequenceId); compositions.set(sequenceId, composition) }
    frames.set(`${sequenceId}:${frame}`, { document: composition, frame })
  }
  for (const target of targets) {
    const sequence = document.sequences.find(sequence => sequence.id === target.sequenceId)
    const clip = sequence?.clips.find(clip => clip.id === target.clipId)
    if (!sequence || !clip) throw new Error('原试渲染片段已移除。')
    add(sequence.id, clip.start); add(sequence.id, clip.start + clip.duration - 1)
    for (const transition of sequence.transitions ?? []) if ([transition.leftClipId, transition.rightClipId].includes(clip.id)) {
      const window = videoEditTransitionWindow(sequence, transition)
      for (const frame of [window.start, window.cut, window.end - 1]) add(sequence.id, frame)
    }
  }
  if (selected) { const key = `${selected.sequenceId}:${selected.frame}`; frames.delete(key); add(selected.sequenceId, selected.frame) }
  if (frames.size > 257) throw new Error('试渲染边界超过257帧，请缩小编辑范围。')
  return [...frames.values()]
}
/** Hidden state cannot certify a source by merely producing an empty bitmap.
 * Each target gets a separate, nonpersistent composition with honest clocks;
 * the final preview retains the user's original visibility and effect switches. */
export function videoEditCodeValidationFrames(document: VideoEditDocument, targets: VideoEditTrialTarget[], selected: { sequenceId: string; frame: number }): Array<{ document: VideoEditComposition; frame: number }> {
  if (!targets.length || targets.length > 32) throw new Error('每次检查1到32个片段。')
  const frames: Array<{ document: VideoEditComposition; frame: number }> = []
  for (const target of targets) {
    const actual = videoEditComposition(document, target.sequenceId)
    const visible = videoEditVisibleTracks(actual); const ids = new Set([target.clipId])
    for (const transition of actual.transitions ?? []) if ([transition.leftClipId, transition.rightClipId].includes(target.clipId)) { ids.add(transition.leftClipId); ids.add(transition.rightClipId) }
    const targetTracks = new Set(actual.clips.filter(clip => ids.has(clip.id)).map(clip => clip.track))
    const forced: VideoEditComposition = { ...actual,
      tracks: actual.tracks.map(track => ({ ...track, enabled: visible.has(track.index) || targetTracks.has(track.index), solo: false })),
      clips: actual.clips.filter(clip => visible.has(clip.track) || ids.has(clip.id)).map(clip => clip.id === target.clipId ? { ...clip, opacity: 1, effects: clip.effects?.map(effect => !target.effectIds || target.effectIds.includes(effect.id) ? { ...effect, enabled: true, amount: 1 } : effect) } : clip),
      transitions: actual.transitions?.filter(transition => actual.clips.some(clip => clip.id === transition.leftClipId && (visible.has(clip.track) || ids.has(clip.id))) && actual.clips.some(clip => clip.id === transition.rightClipId && (visible.has(clip.track) || ids.has(clip.id)))),
    }
    for (const input of videoEditCodeTrialFrames(document, [target])) frames.push({ document: forced, frame: input.frame })
  }
  frames.push({ document: videoEditComposition(document, selected.sequenceId), frame: selected.frame })
  if (frames.length > 257) throw new Error('试渲染边界超过257帧，请缩小编辑范围。')
  return frames
}

let tail: Promise<void> = Promise.resolve()
let waiting = 0
/** One bounded queue for creation, source candidates and explicit version binds.
 * Every trial uses the production full-composition worker and releases it. */
export async function trialVideoEditCodeFrames(frames: Array<{ document: VideoEditComposition; frame: number }>, signal: AbortSignal, keepLast = false): Promise<ImageBitmap | undefined> {
  if (!frames.length || frames.length > 257) throw new Error('源码检查需要1到257个边界画面。')
  if (waiting >= 4) throw new Error('代码素材试渲染队列已满，请等待当前检查完成。')
  waiting++; const previous = tail; let release!: () => void
  tail = new Promise<void>(resolve => { release = resolve })
  await previous
  let renderer: VideoEditRenderSession | undefined; let sequenceId: string | undefined; let bitmap: ImageBitmap | undefined
  let expired = false; let timer: ReturnType<typeof setTimeout> | undefined; let abort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error('源码试渲染超过30秒，已释放候选；请重新检查。')) }, 30_000)
      abort = () => { expired = true; reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
    })
    for (const input of frames) {
      signal.throwIfAborted()
      if (renderer && sequenceId !== input.document.id) { await renderer.dispose(); renderer = undefined }
      if (!renderer) { renderer = new VideoEditRenderSession(input.document); sequenceId = input.document.id }
      else await Promise.race([renderer.updateDocument(input.document), deadline])
      const result = await Promise.race([renderer.present(input.frame).then(result => {
        if (expired || signal.aborted) { result.bitmap?.close(); throw signal.reason ?? new Error('源码候选已失效。') }
        return result
      }), deadline])
      bitmap?.close(); bitmap = result.bitmap
      if (!result.presented || !bitmap) throw new Error('源码候选没有生成可用画面。')
    }
    signal.throwIfAborted()
    // Keep ownership until teardown succeeds; a failed teardown must close the candidate too.
    await renderer?.dispose(); renderer = undefined
    const kept = keepLast ? bitmap : undefined
    if (!keepLast) bitmap?.close()
    bitmap = undefined; return kept
  } finally {
    bitmap?.close(); clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort)
    try { await renderer?.dispose() } finally { waiting--; release() }
  }
}

export async function trialVideoEditCodeDocument(owner: VideoEditInstance, baseline: VideoEditDocument, document: VideoEditDocument, sequenceId: string, frame: number, signal?: AbortSignal, targets?: VideoEditTrialTarget[]): Promise<void> {
  signal?.throwIfAborted()
  const controller = new AbortController(); const cancel = (): void => controller.abort(signal?.reason ?? new Error('代码编辑已取消。'))
  signal?.addEventListener('abort', cancel, { once: true })
  const assert = (): void => { if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) throw new Error('原剪辑已关闭或内容已改变，请重新编辑。') }
  const off = subscribeVideoEditDomain(() => { try { assert() } catch (error) { controller.abort(error) } })
  try {
    assert(); await ensureVideoEditCodeDocumentMetadata(owner, document, controller.signal)
    await trialVideoEditCodeFrames(targets ? videoEditCodeValidationFrames(document, targets, { sequenceId, frame }) : [{ document: videoEditComposition(document, sequenceId), frame }], controller.signal)
    controller.signal.throwIfAborted(); assert()
  } finally { off(); signal?.removeEventListener('abort', cancel) }
}
