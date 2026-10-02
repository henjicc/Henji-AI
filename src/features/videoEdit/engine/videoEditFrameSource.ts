import type { VideoSample } from 'mediabunny'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditFrameCache } from './videoEditFrameCache'
import type { VideoEditGpuFrame } from './videoEditGpuFrame'

/**
 * Decoding contract of the edit renderer. Every picture a backend delivers is a `VideoSample` that goes through
 * `VideoEditGpuCompositor.snapshot()`, the single point where pictures enter owned GPU memory; compositing,
 * frame caching and export never see which backend decoded a picture.
 */

/** One block of decoded sound; structurally a mediabunny `AudioSample`. */
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
  frames(startSeconds: number): AsyncGenerator<VideoSample, void, unknown>
  /** The picture showing at `seconds`, or null when there is none. */
  frameAt(seconds: number): Promise<VideoSample | null>
}

/** Sound reads of one clip. */
export interface VideoEditClipAudio {
  /** Decoded blocks covering [startSeconds, endSeconds). */
  chunks(startSeconds: number, endSeconds: number): AsyncGenerator<VideoEditAudioChunk, void, unknown>
}

/** One opened source file and revision, shared by every clip, playback schedule and mix that reads it. */
export interface VideoEditFrameSource {
  /** WebCodecs codec string of the picture stream; selects the owned GPU format of its pictures. */
  readonly codec?: string
  /** A new picture reader for one clip, or undefined when the file has no picture stream. */
  clipFrames(): VideoEditClipFrames | undefined
  /** A new sound reader for one clip, or undefined when the file has no sound stream. */
  clipAudio(): VideoEditClipAudio | undefined
  /**
   * Forward playback through one long-lived decoder: exactly one picture or null per requested source time, in
   * request order (the picture is the last one starting at or before that time). Null makes the caller use its
   * regular path for that frame. Ends immediately when the file has no picture stream.
   */
  schedule(timestamps: readonly number[]): AsyncGenerator<VideoSample | null, void, unknown>
}

/** Exact-frame seeking of one file with decoded pictures kept in the shared bounded cache. */
export interface VideoEditFrameSeeker {
  /**
   * `direction` is the recent scrub direction (-1, 0, 1); it only steers prefetching. The picture is an owned GPU
   * frame, or a decoded picture the renderer still normalizes.
   */
  sample(time: number, direction: number): Promise<{ sample?: VideoSample | VideoEditGpuFrame; hit: boolean }>
  dispose(): Promise<void>
}

/** Normalizes a decoded picture into owned GPU memory; `compact` keeps 4:2:0 chroma. */
export type VideoEditSnapshot = (sample: VideoSample, compact: boolean) => Promise<VideoEditGpuFrame>

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
 * Whether the renderer plays native frames. Until it does, files that only the native decoder reads are refused at
 * import (with their format) instead of being imported and failing in the program monitor; the native frame backend
 * turns this on together with its renderer integration.
 */
export const VIDEO_EDIT_NATIVE_PLAYBACK_READY = false

/**
 * The single backend choice: native when it decodes every stream of the file, otherwise the browser unless it is
 * known not to decode it, otherwise none (the caller reports the format as undecodable). A forced backend (only
 * from the developer diagnostic setting) is used when it can decode and never silently replaced.
 */
export function chooseVideoEditDecodeBackend(support: VideoEditDecodeSupport, forced?: VideoEditDecodeBackend): VideoEditDecodeBackend | undefined {
  const usable = { native: support.native === 'decodes', browser: support.browser !== 'cannot-decode' }
  if (forced) return usable[forced] ? forced : undefined
  return usable.native ? 'native' : usable.browser ? 'browser' : undefined
}
