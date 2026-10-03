import type { VideoEditClipFrames, VideoEditDecodedPicture } from './videoEditFrameSource'
import type { VideoEditGpuFrame } from './videoEditGpuFrame'

/**
 * Exact pictures for export (task 2.4). Every video layer of an exported frame shows the exact picture at the layer's
 * source time: the last picture of the stream starting at or before that time (the single-frame read's definition,
 * which seeking and the playback schedules share). The renderer passes the picture time `videoEditPictureSeconds()`
 * (source time plus the container timestamp rounding tolerance, task 3.2 D3), the same time preview lookups use, so a
 * picture a container rounded up by under a millisecond is still the exact one at its frame. Nothing shows when the
 * time precedes the stream's first picture (MPEG program streams start after zero on the source timeline). Never a neighbouring picture, and never a transparent
 * layer in place of a picture the decoder did not deliver.
 *
 * Export reads each clip through its sequential reader (`frames(start)`, which keeps decoding ahead of the encoder).
 * A picture whose span covers the time is exact. Anything else is decided by a single-frame read (`frameAt`): a
 * picture the reader skipped (a frame lost on its way, a packet the decoder dropped), a reader that ended or failed, a
 * time before the stream's first picture, a last picture held past its span (variable frame rate, the end of the
 * stream). When that read fails as well the frame fails with the reason in user language and the export stops.
 */

/** A clip's picture between frames: as decoded, or already copied into owned GPU memory by the renderer. */
type ClipPicture = VideoEditDecodedPicture | VideoEditGpuFrame

/** The per-clip read state the export read advances (fields of the renderer's clip source). */
export interface VideoEditExportClipState {
  iterator?: AsyncGenerator<VideoEditDecodedPicture, void, unknown>
  current?: ClipPicture
  previousTime: number
}

export interface VideoEditExportPictureRead {
  /** No picture exists at this time (it precedes the stream's first picture): the layer is transparent. */
  blank: boolean
  /** The sequential reader's picture was not exact, so a single-frame read decided this layer. */
  singleFrameRead: boolean
}

/** A picture starting more than this after the time starts later (the renderer's tolerance). */
const STARTS_LATER = 1e-6
/** A picture ending within this of the time has ended (the renderer's tolerance). */
const ENDED = 1e-7
/** A forward jump longer than this starts a new reader instead of decoding through (the renderer's rule). */
const JUMP_SECONDS = 2

interface ReaderState {
  /** Takes back the picture the consumer just received; the next pull delivers it again. */
  holdBack(picture: VideoEditDecodedPicture): void
  /** The underlying reader has no more pictures. */
  done: boolean
}
const readers = new WeakMap<object, ReaderState>()

/**
 * A sequential reader that can take back one picture delivered ahead of the time asked for. The held picture belongs
 * to the reader: `return()`, which every place dropping a clip source calls, closes it with the underlying reader.
 */
function holdingReader(reader: AsyncGenerator<VideoEditDecodedPicture, void, unknown>): AsyncGenerator<VideoEditDecodedPicture, void, unknown> {
  let held: VideoEditDecodedPicture | undefined
  const state: ReaderState = { done: false, holdBack: picture => { held?.close(); held = picture } }
  const iterator = (async function* (): AsyncGenerator<VideoEditDecodedPicture, void, unknown> {
    try {
      for (;;) {
        if (held) { const picture = held; held = undefined; yield picture; continue }
        const next = await reader.next()
        if (next.done) { state.done = true; return }
        yield next.value
      }
    } finally {
      held?.close(); held = undefined
      await reader.return(undefined)
    }
  })()
  readers.set(iterator, state)
  return iterator
}

function covers(picture: ClipPicture | undefined, time: number): boolean {
  return !!picture && picture.timestamp <= time + STARTS_LATER && picture.timestamp + picture.duration > time + ENDED
}

/**
 * User-language failure of an exact read. Backend reasons are already user language and name the clip, which then
 * appears once; anything else (a raw decoder message) becomes a generic reason and stays in `cause` for the log.
 */
function exactReadError(name: string, cause: unknown): Error {
  const prefix = `素材「${name}」`
  const reason = cause instanceof Error ? cause.message : String(cause)
  const detail = !/[一-鿿]/.test(reason) ? '解码失败，请确认文件可用，或在项目素材中重新定位源文件。' : reason.startsWith(prefix) ? reason.slice(prefix.length).replace(/^的/, '') : reason
  return new Error(`${prefix}取不到准确的画面：${detail}`, { cause })
}

/**
 * Advances one clip of an exported frame to the exact picture at `time` (source seconds): afterwards `clip.current`
 * is that picture, or undefined with `blank` when the stream has none there. Throws in user language when neither the
 * sequential reader nor a single-frame read yields it.
 */
export async function readVideoEditExportPicture(clip: VideoEditExportClipState, video: VideoEditClipFrames, time: number, name: string): Promise<VideoEditExportPictureRead> {
  if (!clip.iterator || time < clip.previousTime || time - clip.previousTime > JUMP_SECONDS) {
    clip.current?.close(); clip.current = undefined
    await clip.iterator?.return(undefined)
    clip.iterator = holdingReader(video.frames(time))
  }
  const reader = clip.iterator
  let readerFailed = false
  try {
    while (!clip.current || clip.current.timestamp + clip.current.duration <= time + ENDED) {
      const next = await reader.next()
      if (next.done) break
      // A picture of a later time waits in the reader; the current one stays until this time is decided.
      if (next.value.timestamp > time + STARTS_LATER) {
        const state = readers.get(reader)
        if (state) state.holdBack(next.value)
        else { next.value.close(); readerFailed = true }
        break
      }
      clip.current?.close(); clip.current = next.value
    }
  } catch {
    // A failed reader: a single-frame read decides this frame and the next frame starts a new reader. If the
    // single-frame read fails as well, its reason is the one the user sees.
    readerFailed = true
  }
  if (readerFailed) { clip.iterator = undefined; await reader.return(undefined).catch(() => undefined) }
  if (covers(clip.current, time)) return { blank: false, singleFrameRead: false }
  let picture: VideoEditDecodedPicture | null
  try { picture = await video.frameAt(time) } catch (error) { throw exactReadError(name, error) }
  if (picture && picture.timestamp > time + STARTS_LATER) {
    picture.close()
    throw exactReadError(name, new Error('读取到的画面时间不对，请重新导出。'))
  }
  // The latest picture starting at or before the time wins: one the reader skipped, or the held one it confirms.
  if (picture && (!clip.current || picture.timestamp > clip.current.timestamp + STARTS_LATER)) {
    clip.current?.close(); clip.current = picture
    // A reader that ended before this picture missed the rest of the stream: the next frame starts a new one.
    const ended = clip.iterator
    if (ended && readers.get(ended)?.done) { clip.iterator = undefined; await ended.return(undefined) }
  } else picture?.close()
  return { blank: !clip.current, singleFrameRead: true }
}
