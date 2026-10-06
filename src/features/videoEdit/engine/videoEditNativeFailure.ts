import { videoEditSourceReadError } from './videoEditSourceErrors'

/**
 * Kinds of native decoding failures (task 3.1), by the decoder error code the main process attaches
 * (`VideoDecoderErrorCode`, carried through the frame channel as `code`):
 * - `service`: the native service or the frame channel failed (process exited or hung, a session lost with it,
 *   a shared texture that could not be imported or delivered). A file the browser decodes moves to the browser;
 *   one only native decodes is retried on a new session, which waits for the restarted service.
 * - `file`: native cannot read or decode this file. The browser is tried when it decodes the file; otherwise the
 *   failure is shown in place and the next request tries again (a relinked or restored file).
 * - `budget`: the decoding resource budget is full (sessions, video memory): shown in place, never retried in a loop.
 * - `closed`: the preview itself is closing; nothing to recover.
 */
export type VideoEditNativeFailureKind = 'service' | 'file' | 'budget' | 'closed'

const FILE_CODES = new Set(['OPEN_FAILED', 'STREAM_INFO_FAILED', 'DECODE_FAILED', 'UNSUPPORTED_FORMAT', 'FORMAT_CHANGED', 'INVALID_REQUEST', 'UNAUTHORIZED'])
const BUDGET_CODES = new Set(['BUDGET_EXCEEDED'])
const CLOSED_CODES = new Set(['CHANNEL_CLOSED', 'TARGET_GONE'])

export function videoEditNativeFailureKindOf(code: string | undefined): VideoEditNativeFailureKind {
  if (code && FILE_CODES.has(code)) return 'file'
  if (code && BUDGET_CODES.has(code)) return 'budget'
  if (code && CLOSED_CODES.has(code)) return 'closed'
  // Process exits, timeouts, lost sessions, texture import/delivery failures and unknown causes are transient.
  return 'service'
}

/** A failed frame channel request: the main process's message and, for decoder service errors, its code. */
export class VideoEditNativeCallError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'VideoEditNativeCallError'
  }
}

/** A native decoding failure in user language; `cause` keeps the raw reason for logs. */
export class VideoEditNativeFailure extends Error {
  constructor(message: string, readonly kind: VideoEditNativeFailureKind, readonly code: string | undefined, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'VideoEditNativeFailure'
  }
}

/** The failure kind of any error thrown by a native read; errors that are not native failures count as `service`. */
export function videoEditNativeFailureKind(error: unknown): VideoEditNativeFailureKind {
  if (error instanceof VideoEditNativeFailure) return error.kind
  if (error instanceof VideoEditNativeCallError) return videoEditNativeFailureKindOf(error.code)
  return 'service'
}

export function videoEditNativeFailureCode(error: unknown): string | undefined {
  return error instanceof VideoEditNativeFailure || error instanceof VideoEditNativeCallError ? error.code : undefined
}

/** The user-language message of a native failure reading one file, by kind. No decoder or service names. */
export function videoEditNativeFailureMessage(name: string, kind: VideoEditNativeFailureKind): string {
  if (kind === 'service') return `素材「${name}」的解码暂时中断，请稍后重试；如果一直出现，请重启软件。`
  if (kind === 'budget') return '同时读取的视频素材过多，请减少同时显示的视频后重试。'
  if (kind === 'closed') return '预览解码已关闭。'
  return `素材「${name}」解码失败，请确认文件可用，或在素材面板中重新定位源文件。`
}

/** A failed read of an open session in user language, keeping kind and code for the router. */
export function videoEditNativeReadFailure(name: string, error: unknown, kind = videoEditNativeFailureKind(error)): VideoEditNativeFailure {
  if (error instanceof VideoEditNativeFailure) return error
  return new VideoEditNativeFailure(videoEditNativeFailureMessage(name, kind), kind, videoEditNativeFailureCode(error), { cause: error })
}

/** A failed session open: a missing or unreadable file keeps the relink hints the browser backend gives. */
export function videoEditNativeOpenFailure(name: string, error: unknown): VideoEditNativeFailure {
  if (error instanceof VideoEditNativeFailure) return error
  const kind = videoEditNativeFailureKind(error)
  const message = kind === 'file' ? videoEditSourceReadError(name, error).message : videoEditNativeFailureMessage(name, kind)
  return new VideoEditNativeFailure(message, kind, videoEditNativeFailureCode(error), { cause: error })
}

/** The preview (or a reset session) is closing: nothing to recover for this read. */
export function videoEditNativeClosed(kind: Extract<VideoEditNativeFailureKind, 'closed' | 'service'> = 'closed'): VideoEditNativeFailure {
  return new VideoEditNativeFailure('预览解码已关闭。', kind, kind === 'closed' ? 'CHANNEL_CLOSED' : 'SESSION_GONE')
}
