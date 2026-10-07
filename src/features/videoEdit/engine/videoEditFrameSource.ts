import type { VideoSample } from 'mediabunny'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditFrameCache } from './videoEditFrameCache'
import type { VideoEditGpuFrame } from './videoEditGpuFrame'
import type { VideoEditNativePicture } from './videoEditNativePicture'

/**
 * Decoding contract of the edit renderer. Every picture a backend delivers goes through
 * `VideoEditGpuCompositor.snapshot()`, the single point where pictures enter owned GPU memory; compositing,
 * frame caching and export never see which backend decoded a picture.
 */

/**
 * A decoded picture before it enters owned GPU memory: a browser `VideoSample`, or a frame borrowed from the native
 * decoder (`close()` hands it back instead of closing it). Both expose the same times, sizes, rotation and format.
 */
export type VideoEditDecodedPicture = VideoSample | VideoEditNativePicture

/**
 * One block of decoded sound; structurally a mediabunny `AudioSample`.
 *
 * Time is the absolute source timeline in seconds (container presentation time, not rebased to the stream start), the
 * same clock as clip source in-points (`sourceInUs`), so a stream starting at 0.523s has silence before it. Sample `i`
 * of the block plays at `timestamp + i / sampleRate`; `duration` is `numberOfFrames / sampleRate`.
 *
 * Sample rate (record 012, sound quality first): a reader that resamples well delivers blocks at the rate the mix asks
 * for (the native reader resamples with SoX in the native service), and the mix then takes, for every output sample,
 * the nearest block sample (at most half a sample, about 10µs, of constant offset; no filtering). Blocks at any other
 * rate (the browser reader keeps the stream's rate) are converted by linear interpolation in the mix.
 * Channels keep the stream's layout and the mix alone maps them (mono sequence: average of all channels; otherwise
 * channel c reads channel min(c, channels - 1)), so planes 0 and 1 must be front left and front right when the stream
 * has them.
 */
export interface VideoEditAudioChunk {
  readonly timestamp: number
  readonly duration: number
  readonly numberOfFrames: number
  readonly numberOfChannels: number
  readonly sampleRate: number
  copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void
  close(): void
}

/** Picture reads of one clip. Each clip owns its readers, so two clips of a file never share a decoder position. */
export interface VideoEditClipFrames {
  /** Consecutive pictures, starting with the one showing at `startSeconds`. */
  frames(startSeconds: number): AsyncGenerator<VideoEditDecodedPicture, void, unknown>
  /** The picture showing at `seconds`, or null when there is none. */
  frameAt(seconds: number): Promise<VideoEditDecodedPicture | null>
}

/** Sound reads of one clip. The renderer never reads one clip's sound concurrently (the render worker serializes). */
export interface VideoEditClipAudio {
  /**
   * Decoded blocks covering [startSeconds, endSeconds) in ascending, non-overlapping order (an overlap would be mixed
   * twice). Blocks may start before and end after the range; a gap or a missing block is silence. The mix interpolates
   * between neighbouring samples of one block and holds the last sample of a block, so a reader should deliver the
   * sample before and after the range and as few block boundaries inside it as possible.
   * `sampleRate` is the rate the mix runs at; a reader that resamples well delivers blocks at it.
   */
  chunks(startSeconds: number, endSeconds: number, sampleRate?: number): AsyncGenerator<VideoEditAudioChunk, void, unknown>
  /** Releases decoder resources the reader holds; called once when the renderer drops the clip's source. */
  close?(): void
}

/** One opened source file and revision, shared by every clip, playback schedule and mix that reads it. */
export interface VideoEditFrameSource {
  /** WebCodecs codec string of the picture stream; selects the owned GPU format of its pictures. */
  readonly codec?: string
  /** A new picture reader for one clip, or undefined when the file has no picture stream. */
  clipFrames(): VideoEditClipFrames | undefined
  /**
   * A new sound reader for one clip, or undefined when the file has no sound stream. `audioStream` is the n-th sound
   * stream of the file in file order (task 2.6, both backends number streams alike); without it the reader plays the
   * stream clips without a channel mapping always played (the first one). A missing stream is silence.
   */
  clipAudio(audioStream?: number): VideoEditClipAudio | undefined
  /**
   * Forward playback through one long-lived decoder: exactly one picture or null per requested source time, in
   * request order (the picture is the last one starting at or before that time). Null makes the caller use its
   * regular path for that frame. Ends immediately when the file has no picture stream. Aborting `signal` stops the
   * decode at once where the backend supports it (native), instead of after the picture being decoded.
   */
  schedule(timestamps: readonly number[], signal?: AbortSignal): AsyncGenerator<VideoEditDecodedPicture | null, void, unknown>
  /** Whether this backend decodes every stream of the file; only asked when choosing a backend for it. */
  decodable?(): Promise<boolean>
}

/** Exact-frame seeking of one file with decoded pictures kept in the shared bounded cache. */
export interface VideoEditFrameSeeker {
  /**
   * `direction` is the recent scrub direction (-1, 0, 1); it only steers prefetching. The picture is an owned GPU
   * frame, or a decoded picture the renderer still normalizes.
   */
  sample(time: number, direction: number): Promise<{ sample?: VideoEditDecodedPicture | VideoEditGpuFrame; hit: boolean }>
  dispose(): Promise<void>
}

/** Normalizes a decoded picture into owned GPU memory; `compact` keeps 4:2:0 chroma. */
export type VideoEditSnapshot = (sample: VideoEditDecodedPicture, compact: boolean) => Promise<VideoEditGpuFrame>

/** One decoder implementation; a renderer owns one instance and every source it opens. */
export interface VideoEditFrameBackend {
  /**
   * Opens the source of `media`, sharing one parsed file among all users of the same path and revision.
   * Every call must be paired with exactly one `release(key)`. A failed open is not cached, so a restored or
   * relinked file is read again; its rejection is already in user language.
   */
  open(media: VideoEditMedia): { key: string; ready: Promise<VideoEditFrameSource> }
  release(key: string): void
  seeker(media: VideoEditMedia, cache: VideoEditFrameCache, snapshot: VideoEditSnapshot): VideoEditFrameSeeker
}

/**
 * Decoder implementations. `browser` is Chromium decoding (mediabunny + WebCodecs), the fallback;
 * `native` is the native decoder service, the primary path where it works. Never shown in the interface.
 */
export type VideoEditDecodeBackend = 'native' | 'browser'

/**
 * What each backend can do for one file. `unavailable`: the backend is not running on this machine or could not
 * read the file; `unknown`: not inspected (the project does not record decoding facts, so a renderer opening a
 * saved project only knows the native state).
 */
export interface VideoEditDecodeSupport {
  native: 'decodes' | 'cannot-decode' | 'unavailable'
  browser: 'decodes' | 'cannot-decode' | 'unknown'
}

/**
 * Whether the renderer plays native frames. Before it did, files that only the native decoder reads were refused at
 * import (with their format); the native frame backend (`videoEditNativeFrameSource.ts`) plays them now.
 */
export const VIDEO_EDIT_NATIVE_PLAYBACK_READY = true

/**
 * Whether the native service decodes sound for the renderer (task 2.3). Native sound sessions need protocol 4 of the
 * native service; until its native side is built this stays off and files on the native backend are silent.
 */
export const VIDEO_EDIT_NATIVE_SOUND_READY = true

/**
 * Whether native decoding is the primary path for files the browser also decodes. The picture and the sound of one
 * file are read by one backend; until native sound decoding is in place (task 2.3 stage B), a file the browser
 * decodes completely stays on the browser for both, and native plays the files only it decodes (their sound is
 * silent until then). Task 2.3 stage B turns this on.
 */
export const VIDEO_EDIT_NATIVE_PRIMARY = true

/**
 * The single backend choice. With native primary: native when it decodes every stream of the file, otherwise the
 * browser unless it is known not to decode it. Before that: the browser when it is known to decode the whole file,
 * otherwise native when it decodes it, otherwise the browser unless known not to. No backend means the caller reports
 * the format as undecodable. A forced backend (only from the developer diagnostic setting) is used when it can decode
 * and never silently replaced.
 */
export function chooseVideoEditDecodeBackend(support: VideoEditDecodeSupport, forced?: VideoEditDecodeBackend, nativePrimary = VIDEO_EDIT_NATIVE_PRIMARY): VideoEditDecodeBackend | undefined {
  const usable = { native: support.native === 'decodes', browser: support.browser !== 'cannot-decode' }
  if (forced) return usable[forced] ? forced : undefined
  if (!nativePrimary && support.browser === 'decodes') return 'browser'
  return usable.native ? 'native' : usable.browser ? 'browser' : undefined
}

/**
 * The playback backend of one file where no import probe result is at hand (the render worker, the source monitor).
 * The browser is asked whether it decodes the whole file only when its answer can change the choice; a rejected
 * question counts as cannot decode. Both callers decide the same way, so a file plays on one backend everywhere.
 */
export async function resolveVideoEditDecodeBackend(input: { nativeReads: boolean; forced?: VideoEditDecodeBackend; browserDecodes: () => Promise<boolean>; nativePrimary?: boolean }): Promise<{ backend?: VideoEditDecodeBackend; browser: VideoEditDecodeSupport['browser'] }> {
  const nativePrimary = input.nativePrimary ?? VIDEO_EDIT_NATIVE_PRIMARY
  let browser: VideoEditDecodeSupport['browser'] = 'unknown'
  if (input.nativeReads && !input.forced && !nativePrimary) browser = await input.browserDecodes().then(decodes => decodes ? 'decodes' : 'cannot-decode', () => 'cannot-decode')
  return { backend: chooseVideoEditDecodeBackend({ native: input.nativeReads ? 'decodes' : 'unavailable', browser }, input.forced, nativePrimary), browser }
}
