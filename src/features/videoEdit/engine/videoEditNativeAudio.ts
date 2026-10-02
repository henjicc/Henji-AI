import type { VideoAudioSessionInfo, VideoFramePortCallResults } from '@/platform/contracts/videoFrames'
import type { VideoEditAudioChunk, VideoEditClipAudio } from './videoEditFrameSource'
import type { VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { videoEditSourceReadError } from './videoEditSourceErrors'

/**
 * One opened sound stream of the native decoder service (one per clip reader, so two clips of a file never share a
 * decode position). The service decodes, resamples with SoX to the requested rate (record 012: a mature resampler,
 * sound quality first) and delivers planar float32 in the stream's own channel layout; the mix maps channels.
 */
export interface VideoEditPcmSession {
  /** Output sample rate. Sample `n` plays at `n / sampleRate` seconds on the absolute source timeline. */
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

/**
 * Opens the session of one clip at a sample rate (undefined: the stream's own rate). `null`: the file has no such
 * sound stream, so the clip is silent (not an error).
 */
export type VideoEditPcmOpener = (sampleRate: number | undefined) => Promise<VideoEditPcmSession | null>

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
 * never read) at the rate the mix asks for, and opens again when that rate changes. A failed open or read drops the
 * session, so the next read opens a new one (a restarted service or a restored file); `close()` releases the
 * session, even one still opening.
 */
export function createVideoEditNativeClipAudio(open: VideoEditPcmOpener): Required<VideoEditClipAudio> {
  type Entry = { rate: number | undefined; session: Promise<VideoEditPcmSession | null> }
  let current: Entry | undefined
  let closed = false
  const drop = (entry: Entry | undefined): void => {
    if (!entry || current !== entry) return
    current = undefined
    void entry.session.then(session => session?.close(), () => undefined)
  }
  const session = (rate: number | undefined): Entry => {
    if (closed) throw new Error('声音读取已关闭。')
    if (current && current.rate !== rate) drop(current)
    if (!current) {
      const opening = open(rate).then(opened => {
        if (!opened) return null
        if (closed) { opened.close(); throw new Error('声音读取已关闭。') }
        if (!(Number.isSafeInteger(opened.sampleRate) && opened.sampleRate > 0) || !(Number.isSafeInteger(opened.channels) && opened.channels > 0)) { opened.close(); throw new Error('原生声音流的采样率或声道数无效。') }
        return opened
      })
      const entry: Entry = { rate, session: opening }
      opening.catch(() => { if (current === entry) current = undefined })
      current = entry
    }
    return current
  }
  return {
    async *chunks(startSeconds: number, endSeconds: number, sampleRate?: number): AsyncGenerator<VideoEditAudioChunk, void, unknown> {
      const entry = session(sampleRate)
      const pcm = await entry.session
      if (!pcm) return
      const { first, last } = videoEditPcmReadRange(startSeconds, endSeconds, pcm.sampleRate)
      const limit = pcm.sampleRate * MAX_READ_SECONDS
      for (let next = first; next < last;) {
        const frames = Math.min(limit, last - next)
        let planes: readonly Float32Array[]
        try { planes = await pcm.read(next, frames) } catch (error) { drop(entry); throw error }
        if (closed) throw new Error('声音读取已关闭。')
        if (planes.length !== pcm.channels || planes.some(plane => !(plane instanceof Float32Array) || plane.length !== frames)) { drop(entry); throw new Error('原生声音数据不完整。') }
        yield new PcmChunk(planes, next, pcm.sampleRate)
        next += frames
      }
    },
    close(): void {
      if (closed) return
      closed = true
      const entry = current; current = undefined
      void entry?.session.then(pcm => pcm?.close(), () => undefined)
    },
  }
}

/** The worker-side port of the frame channel, as sound sessions need it. */
export type VideoEditNativeSoundChannel = Pick<VideoEditNativeFrameReceiver, 'call'>

/**
 * Opens a native sound session over the render worker's frame channel: the request goes through the preload to the
 * main process, and each read comes back as one transferred buffer of planar float32. Failures are in user language.
 */
export async function openVideoEditNativePcm(channel: VideoEditNativeSoundChannel, path: string, name: string, options: { audioStream?: number; sampleRate?: number }): Promise<VideoEditPcmSession | null> {
  let info: VideoAudioSessionInfo
  try {
    info = await channel.call('openAudio', { path, ...(options.audioStream !== undefined ? { audioStream: options.audioStream } : {}), ...(options.sampleRate !== undefined ? { sampleRate: options.sampleRate } : {}) })
  } catch (error) { throw videoEditSourceReadError(name, error) }
  if (!info.found) return null
  const { audioId, sampleRate, channels } = info
  let closed = false
  return {
    sampleRate, channels,
    async read(startFrame, frames) {
      if (closed) throw new Error('声音读取已关闭。')
      let result: VideoFramePortCallResults['readAudio']
      try { result = await channel.call('readAudio', { audioId, startFrame, frames }) } catch (error) {
        throw new Error(`素材「${name}」的声音读取失败，请确认文件可用，或在项目素材中重新定位源文件。`, { cause: error })
      }
      const data: unknown = result.data
      if (!(data instanceof ArrayBuffer) || result.frames !== frames || result.channels !== channels || data.byteLength !== frames * channels * 4) throw new Error('原生声音数据不完整。')
      return Array.from({ length: channels }, (_, channel) => new Float32Array(data, channel * frames * 4, frames))
    },
    close() {
      if (closed) return
      closed = true
      void channel.call('closeAudio', { audioId }).catch(() => undefined)
    },
  }
}
