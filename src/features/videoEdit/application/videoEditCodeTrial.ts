import { videoEditOffscreenPool, type VideoEditOffscreenLease } from '../engine/videoEditOffscreenPool'
import { type CodeFramePerformance } from '@/core/videoEdit/codeMaterial/performance'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditComposition, videoEditDuration, videoEditVisibleTracks, type VideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { ensureVideoEditChangedCodeMetadata } from './videoEditCodeState'
import { subscribeVideoEditDomain, type VideoEditInstance } from './videoEditService'
import { videoEditTransitionClipIds, videoEditTransitionWindow } from '@/core/videoEdit/transitions'

export interface VideoEditTrialTarget { sequenceId: string; clipId: string; effectIds?: string[] }
/** Exact original-clock endpoints, plus every affected transition boundary. */
export function videoEditCodeTrialFrames(document: VideoEditDocument, targets: VideoEditTrialTarget[], selected?: { sequenceId: string; frame: number }): Array<{ document: VideoEditComposition; frame: number }> {
  if (!targets.length) throw new Error('请选择要检查的片段。')
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
    for (const transition of sequence.transitions ?? []) if (videoEditTransitionClipIds(transition).includes(clip.id)) {
      const window = videoEditTransitionWindow(sequence, transition)
      for (const frame of [window.start, window.cut, window.end - 1]) add(sequence.id, frame)
    }
  }
  if (selected) { const key = `${selected.sequenceId}:${selected.frame}`; frames.delete(key); add(selected.sequenceId, selected.frame) }
  return [...frames.values()]
}
/** Hidden state cannot certify a source by merely producing an empty bitmap.
 * Each target gets a separate, nonpersistent composition with honest clocks;
 * the final preview retains the user's original visibility and effect switches. */
export function videoEditCodeValidationFrames(document: VideoEditDocument, targets: VideoEditTrialTarget[], selected: { sequenceId: string; frame: number }): Array<{ document: VideoEditComposition; frame: number }> {
  if (!targets.length) throw new Error('请选择要检查的片段。')
  const frames: Array<{ document: VideoEditComposition; frame: number }> = []
  for (const target of targets) {
    const actual = videoEditComposition(document, target.sequenceId)
    const visible = videoEditVisibleTracks(actual); const ids = new Set([target.clipId])
    for (const transition of actual.transitions ?? []) if (videoEditTransitionClipIds(transition).includes(target.clipId)) videoEditTransitionClipIds(transition).forEach(id => ids.add(id))
    const targetTracks = new Set(actual.clips.filter(clip => ids.has(clip.id)).map(clip => clip.track))
    const forced: VideoEditComposition = { ...actual,
      tracks: actual.tracks.map(track => ({ ...track, enabled: visible.has(track.index) || targetTracks.has(track.index), solo: false })),
      clips: actual.clips.filter(clip => visible.has(clip.track) || ids.has(clip.id)).map(clip => clip.id === target.clipId ? { ...clip, opacity: 1, effectsEnabled: true, effects: clip.effects?.map(effect => !target.effectIds || target.effectIds.includes(effect.id) ? { ...effect, enabled: true, amount: 1 } : effect) } : clip),
      transitions: actual.transitions?.filter(transition => videoEditTransitionClipIds(transition).every(id => actual.clips.some(clip => clip.id === id && (visible.has(clip.track) || ids.has(clip.id))))),
    }
    for (const input of videoEditCodeTrialFrames(document, [target])) frames.push({ document: forced, frame: input.frame })
  }
  frames.push({ document: videoEditComposition(document, selected.sequenceId), frame: selected.frame })
  return frames
}

/** One serial queue for creation, source candidates and explicit version binds.
 * Every trial holds an exclusive lease on the production offscreen worker. */
/** `collect` receives every presented frame (caller owns and closes them); used for short animated previews. */
export async function trialVideoEditCodeFrames(frames: Array<{ document: VideoEditComposition; frame: number }>, signal: AbortSignal, keepLast = false, collect?: ImageBitmap[], measurements?: CodeFramePerformance[], observe?: (value: import('@/core/videoEdit/codeAuthorProgram').CodeAuthorFrameObservation) => void): Promise<ImageBitmap | undefined> {
  if (!frames.length) throw new Error('源码检查需要边界画面。')
  signal.throwIfAborted()
  let renderer: VideoEditRenderSession | undefined; let lease: VideoEditOffscreenLease | undefined; let bitmap: ImageBitmap | undefined
  const poolAbort = new AbortController()
  let succeeded = false
  let expired = false; let timer: ReturnType<typeof setTimeout> | undefined; let abort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    let rejectDeadline!: (reason: Error) => void
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reason => { poolAbort.abort(reason); reject(reason) }
      abort = () => { expired = true; poolAbort.abort(signal.reason); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
    })
    // Teardown and module loading also have asynchronous boundaries before the next race.
    void deadline.catch(() => undefined)
    timer = setTimeout(() => { expired = true; rejectDeadline(new Error('试渲染等待过久，请重试。')) }, 30_000)

    signal.throwIfAborted()
    for (const input of frames) {
      signal.throwIfAborted()
      const preparationStarted = performance.now()
      let sessionReused = !!renderer
      // Detect a stalled frame, rather than imposing a total duration/count budget on a large edit.
      clearTimeout(timer)
      timer = setTimeout(() => { expired = true; rejectDeadline(new Error('源码单帧试渲染超过30秒，已释放候选；请重新检查。')) }, 30_000)
      if (!lease) {
        const acquiring = videoEditOffscreenPool.acquire(input.document, poolAbort.signal, async document => {
          const { VideoEditRenderSession } = await import('../engine/videoEditRenderSession')
          return new VideoEditRenderSession(document)
        }).then(value => {
          if (expired || signal.aborted) { void value.release(true); throw signal.reason ?? new Error('试渲染已超时。') }
          return value
        })
        lease = await Promise.race([acquiring, deadline]); renderer = lease.session; sessionReused = lease.reused
      } else await Promise.race([renderer!.replaceContent(input.document), deadline])
      const present = async (frame: number): ReturnType<VideoEditRenderSession['present']> => {
        signal.throwIfAborted()
        clearTimeout(timer)
        timer = setTimeout(() => { expired = true; rejectDeadline(new Error('源码单帧试渲染超过30秒，已释放候选；请重新检查。')) }, 30_000)
        return await Promise.race([renderer!.present(frame, false, false, undefined, undefined, undefined, 'interactive', false, Boolean(observe)).then(result => {
          if (expired || signal.aborted) { result.bitmap?.close(); throw signal.reason ?? new Error('源码候选已失效。') }
          if (result.authorElements && frame === input.frame) observe?.(result.authorElements)
          return result
        }), deadline])
      }
      let result = await present(input.frame)
      bitmap?.close(); bitmap = result.bitmap
      if (result.effectErrors?.length) throw new Error(result.effectErrors.join('\n'))
      if (!result.presented || !bitmap) throw new Error('源码候选没有生成可用画面。')
      if (measurements && result.codePerformance?.length) {
        const first = result.codePerformance
        const preparation = { wallMs: performance.now() - preparationStarted, cpuMs: first.reduce((sum, sample) => sum + sample.cpuMs, 0), gpuMs: first.reduce((sum, sample) => sum + sample.gpuMs, 0), sessionReused }
        // Warm the requested resources first, then traverse an adjacent frame so
        // animated output cannot report the cheap identical-frame cache as playback.
        const precedingFrame = input.frame > 0 ? input.frame - 1 : Math.min(1, Math.max(0, videoEditDuration(input.document) - 1))
        let sampling: NonNullable<CodeFramePerformance['sampling']> = { mode: precedingFrame === input.frame ? 'repeat-frame' : 'adjacent-frame', precedingFrame }
        try {
          const warmup = await present(precedingFrame)
          warmup.bitmap?.close()
          if (!warmup.presented || warmup.effectErrors?.length) throw new Error(warmup.effectErrors?.join('\n') || '相邻帧没有生成画面。')
          const steady = await present(input.frame)
          if (!steady.presented || !steady.bitmap || steady.effectErrors?.length || !steady.codePerformance?.length) { steady.bitmap?.close(); throw new Error(steady.effectErrors?.join('\n') || '稳态采样没有返回画面及成本。') }
          bitmap.close(); bitmap = steady.bitmap; result = steady
        } catch (error) {
          // Optional diagnostics must not change acceptance of the requested
          // frame (e.g. a neighbour exceeds its author budget). Preserve its pixels
          // and expose the failed sample explicitly, never label it as steady.
          if (expired || signal.aborted) throw error
          sampling = { mode: 'unavailable', precedingFrame, error: error instanceof Error ? error.message : String(error) }
        }
        measurements.push(...(result.codePerformance ?? first).map(value => ({ ...value, frame: input.frame, budgetMs: 1000 / input.document.fps, preparation, sampling })))
      }
      if (collect) { collect.push(bitmap); bitmap = undefined }
    }
    signal.throwIfAborted()
    // Keep ownership until teardown succeeds; a failed teardown must close the candidate too.
    succeeded = true
    const kept = keepLast ? bitmap : undefined
    if (!keepLast) bitmap?.close()
    bitmap = undefined; return kept
  } finally {
    bitmap?.close(); clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort)
    await lease?.release(!succeeded || expired || signal.aborted)
  }
}

export async function trialVideoEditCodeDocument(owner: VideoEditInstance, contentVersion: number, document: VideoEditDocument, sequenceId: string, frame: number, signal?: AbortSignal, targets?: VideoEditTrialTarget[]): Promise<void> {
  signal?.throwIfAborted()
  const controller = new AbortController(); const cancel = (): void => controller.abort(signal?.reason ?? new Error('代码编辑已取消。'))
  signal?.addEventListener('abort', cancel, { once: true })
  const assert = (): void => { if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('原剪辑已关闭或内容已改变，请重新编辑。') }
  const off = subscribeVideoEditDomain(() => { try { assert() } catch (error) { controller.abort(error) } })
  try {
    assert(); await ensureVideoEditChangedCodeMetadata(owner, owner.document, document, controller.signal)
    await trialVideoEditCodeFrames(targets ? videoEditCodeValidationFrames(document, targets, { sequenceId, frame }) : [{ document: videoEditComposition(document, sequenceId), frame }], controller.signal)
    controller.signal.throwIfAborted(); assert()
  } finally { off(); signal?.removeEventListener('abort', cancel) }
}
