import type { NativeVideoFrame } from './videoEditNativeFrames'

export type VideoEditNativeRotation = 0 | 90 | 180 | 270

/**
 * Clockwise display rotation from the native decoder's display matrix angle. FFmpeg reports the counter-clockwise
 * angle of the matrix; mediabunny (the browser backend) reports the clockwise rotation needed for display, so the
 * same file shows the same way on both backends.
 */
export function videoEditNativeRotation(degrees: number | null | undefined): VideoEditNativeRotation {
  if (typeof degrees !== 'number' || !Number.isFinite(degrees)) return 0
  return ((((Math.round(-degrees / 90) * 90) % 360) + 360) % 360) as VideoEditNativeRotation
}

/**
 * A decoded picture borrowed from the native decoder: a shared GPU texture frame that must go back to the renderer
 * process main thread (record 002). It enters owned memory only through `VideoEditGpuCompositor.snapshot()`, which
 * imports the borrowed frame and keeps it borrowed until the copy's GPU work completes; the picture is never wrapped
 * in a mediabunny `VideoSample` (whose `close()` would close the frame in the worker and crash the process).
 *
 * Shaped like the parts of a `VideoSample` the renderer reads; `close()` hands the frame back instead of closing it.
 * Times are seconds on the same clock as the browser backend (`ptsUs` is mediabunny's `microsecondTimestamp`).
 */
export class VideoEditNativePicture {
  readonly timestamp: number
  readonly duration: number
  readonly codedWidth: number
  readonly codedHeight: number
  readonly displayWidth: number
  readonly displayHeight: number
  readonly flip = false
  /** `NV12` for 8-bit 4:2:0 material, null for `rgbaf16` (WebCodecs has no such format). */
  readonly format: VideoFrame['format']
  private readonly fences: Promise<unknown>[] = []
  private returned = false

  constructor(private readonly native: NativeVideoFrame, readonly rotation: VideoEditNativeRotation, frameDurationSeconds: number) {
    const frame = native.frame
    const ptsUs = native.meta.ptsUs ?? native.meta.timestampUs
    this.timestamp = ptsUs / 1e6
    this.duration = native.meta.durationUs && native.meta.durationUs > 0 ? native.meta.durationUs / 1e6 : frameDurationSeconds
    this.codedWidth = frame.codedWidth; this.codedHeight = frame.codedHeight
    const width = frame.visibleRect?.width ?? frame.codedWidth; const height = frame.visibleRect?.height ?? frame.codedHeight
    const quarter = rotation === 90 || rotation === 270
    this.displayWidth = quarter ? height : width; this.displayHeight = quarter ? width : height
    this.format = frame.format
  }

  /** The borrowed frame, only for `importExternalTexture`. Never close it, clone it or keep it past `close()`. */
  get frame(): VideoFrame {
    if (this.returned) throw new Error('预览帧已释放。')
    return this.native.frame
  }

  /** Keeps the frame borrowed until GPU work reading it (an external texture import) has completed. */
  holdUntil(work: Promise<unknown>): void { this.fences.push(work) }

  /** Hands the frame back to the main thread once every GPU read has completed; safe to call more than once. */
  close(): void {
    if (this.returned) return
    this.returned = true
    void Promise.allSettled(this.fences).then(() => this.native.release())
  }
}
