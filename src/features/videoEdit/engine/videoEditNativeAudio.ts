import type { VideoEditAudioChunk, VideoEditClipAudio } from './videoEditFrameSource'

/**
 * One opened sound stream of the native decoder service (one per clip reader, so two clips of a file never share a
 * decode position). The service decodes and converts to planar float32 at the stream's own rate and channels; it does
 * not resample or remix (`VideoEditRenderer.mixAudio` owns both, identically for every backend).
 */
export interface VideoEditPcmSession {
  /** Stream sample rate. Sample `n` plays at `n / sampleRate` seconds on the absolute source timeline. */
  readonly sampleRate: number
  /** Planes per read, in FFmpeg native order: front left and front right first when the layout has them. */
  readonly channels: number
  /**
   * Exactly `frames` samples per channel starting at absolute sample `startFrame` (which may be negative), with
   * silence wherever the stream has no sound: before its start, in gaps and after its end. Adjacent and overlapping
   * reads are sequential decoding; any other start seeks.
   */
  read(startFrame: number, frames: number): Promise<readonly Float32Array[]>
  close(): void
}

/** Guard samples on each side so the mix can interpolate at the range edges despite floating-point rounding. */
const GUARD_FRAMES = 1
/** Longest single read; mixes ask for at most one second, so a mix normally reads once and has no inner block boundary. */
const MAX_READ_SECONDS = 2

/** Absolute sample range `[first, last)` that a read of source seconds `[start, end)` needs at `sampleRate`. */
export function videoEditPcmReadRange(startSeconds: number, endSeconds: number, sampleRate: number): { first: number; last: number } {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || !(Number.isSafeInteger(sampleRate) && sampleRate > 0)) throw new Error('声音读取范围无效。')
  if (endSeconds <= startSeconds) return { first: 0, last: 0 }
  // The mix needs the sample at or before the range start and the one after the last sample before its end.
  return { first: Math.floor(startSeconds * sampleRate) - GUARD_FRAMES, last: Math.ceil(endSeconds * sampleRate) + 1 + GUARD_FRAMES }
}

class PcmChunk implements VideoEditAudioChunk {
  readonly timestamp: number
  readonly duration: number
  readonly numberOfFrames: number
  readonly numberOfChannels: number
  private planes: readonly Float32Array[] | undefined
  constructor(planes: readonly Float32Array[], startFrame: number, readonly sampleRate: number) {
    this.planes = planes; this.numberOfChannels = planes.length; this.numberOfFrames = planes[0].length
    this.timestamp = startFrame / sampleRate; this.duration = this.numberOfFrames / sampleRate
  }
  copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void {
    if (!this.planes) throw new Error('声音数据已释放。')
    if (options.format !== 'f32-planar') throw new Error('声音数据只支持平面浮点格式。')
    const plane = this.planes[options.planeIndex]
    if (!Number.isInteger(options.planeIndex) || !plane) throw new RangeError('声道序号超出范围。')
    if (destination.length < plane.length) throw new RangeError('声音数据目标空间不足。')
    destination.set(plane)
  }
  close(): void { this.planes = undefined }
}

/**
 * The native sound reader of one clip. The session opens on the first read (picture clips also get a reader they
 * never read) and a failed open is retried on the next read; `close()` releases the session, even one still opening.
 */
export function createVideoEditNativeClipAudio(open: () => Promise<VideoEditPcmSession>): Required<VideoEditClipAudio> {
  let session: Promise<VideoEditPcmSession> | undefined
  let closed = false
  const current = (): Promise<VideoEditPcmSession> => {
    if (closed) return Promise.reject(new Error('声音读取已关闭。'))
    if (!session) {
      const opening = open().then(opened => {
        if (closed) { opened.close(); throw new Error('声音读取已关闭。') }
        if (!(Number.isSafeInteger(opened.sampleRate) && opened.sampleRate > 0) || !(Number.isSafeInteger(opened.channels) && opened.channels > 0)) { opened.close(); throw new Error('原生声音流的采样率或声道数无效。') }
        return opened
      })
      opening.catch(() => { if (session === opening) session = undefined })
      session = opening
    }
    return session
  }
  return {
    async *chunks(startSeconds: number, endSeconds: number): AsyncGenerator<VideoEditAudioChunk, void, unknown> {
      const pcm = await current()
      const { first, last } = videoEditPcmReadRange(startSeconds, endSeconds, pcm.sampleRate)
      const limit = pcm.sampleRate * MAX_READ_SECONDS
      for (let next = first; next < last;) {
        const frames = Math.min(limit, last - next)
        const planes = await pcm.read(next, frames)
        if (closed) throw new Error('声音读取已关闭。')
        if (planes.length !== pcm.channels || planes.some(plane => !(plane instanceof Float32Array) || plane.length !== frames)) throw new Error('原生声音数据不完整。')
        yield new PcmChunk(planes, next, pcm.sampleRate)
        next += frames
      }
    },
    close(): void {
      if (closed) return
      closed = true
      const opened = session; session = undefined
      void opened?.then(pcm => pcm.close(), () => undefined)
    },
  }
}
