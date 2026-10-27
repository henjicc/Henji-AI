import type { Rectangle, WebContents } from 'electron'

/** One captured frame: the picture that carries the frame's capture token. */
export interface TakenFrame {
  /** Everything repainted since the previous taken frame (in-between repaints included). */
  dirty: Rectangle
  /** The picture differs from the previous taken frame (or is the first). */
  changed: boolean
  width: number
  height: number
  /** Layout of `bitmap()`: BGRA, or NV12 (BT.601 limited range, even width and height). */
  format: 'bgra' | 'nv12'
  /** The whole picture, token painted over; a copy the caller may keep. */
  bitmap(): Buffer
  /** A small JPEG data URL for the live preview. */
  previewJpeg(): string
}

/**
 * Where the replay's pictures come from. Two ways, same result: the browser's CPU paint images, or GPU
 * shared textures read back by a WebGPU reader window (much faster at 4K). Both identify a frame by its
 * capture token, so a frame is never an earlier picture.
 */
export interface FrameSource {
  attach(contents: WebContents): void
  /** The picture showing `token`, or null after `timeoutMs` without one. */
  take(token: number, timeoutMs: number): Promise<TakenFrame | null>
  /** The newest picture whatever it shows (the token is hidden, e.g. under a top-layer dialog). */
  takeLatest(): Promise<TakenFrame | null>
  /** Forgets pictures so far. */
  discard(): void
  /** Counters for the log. */
  stats(): Record<string, number>
  dispose(): Promise<void>
}
