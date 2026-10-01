import type { VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { ensureVideoEditCodeDocumentMetadata } from './videoEditCodeState'
import { listVideoEditInstances, subscribeVideoEditDomain, type VideoEditInstance } from './videoEditService'

let tail: Promise<void> = Promise.resolve()
let waiting = 0
/** One bounded queue for creation, source candidates and explicit version binds.
 * Every trial uses the production full-composition worker and releases it. */
export async function trialVideoEditCodeFrames(frames: Array<{ document: VideoEditComposition; frame: number }>, signal: AbortSignal, keepLast = false): Promise<ImageBitmap | undefined> {
  if (!frames.length || frames.length > 32) throw new Error('源码检查需要1到32个画面。')
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

export async function trialVideoEditCodeDocument(owner: VideoEditInstance, baseline: VideoEditDocument, document: VideoEditDocument, sequenceId: string, frame: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const controller = new AbortController(); const cancel = (): void => controller.abort(signal?.reason ?? new Error('代码编辑已取消。'))
  signal?.addEventListener('abort', cancel, { once: true })
  const assert = (): void => { if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) throw new Error('原工程已关闭或内容已改变，请重新编辑。') }
  const off = subscribeVideoEditDomain(() => { try { assert() } catch (error) { controller.abort(error) } })
  try {
    assert(); await ensureVideoEditCodeDocumentMetadata(owner, document, controller.signal)
    await trialVideoEditCodeFrames([{ document: videoEditComposition(document, sequenceId), frame }], controller.signal)
    controller.signal.throwIfAborted(); assert()
  } finally { off(); signal?.removeEventListener('abort', cancel) }
}
