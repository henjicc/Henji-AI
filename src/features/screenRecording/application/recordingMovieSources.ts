import { getPlatform } from '@/platform'
import { captureLogPageSchema, type CaptureEvent } from '@/core/captureLog/events'
import { recordingCursorPageReference, recordingCursorSourceSchema, type RecordingCursorSource } from '@/core/videoEdit/recordingCursor'
import type { RecordingDocument, RecordingMedia } from '@/core/screenRecording/document'

/**
 * Keep immutable page references and pause offsets only, not an hour of 120 Hz samples.
 * `media` defaults to the screen files; a combined file passes the first frame it starts from.
 */
export async function recordingMovieCursorSources(recording: RecordingDocument, signal: AbortSignal, onEvent?: (event: CaptureEvent) => void, media: ReadonlyArray<Pick<RecordingMedia, 'id' | 'monoUs'>> = recording.media.filter(v => v.kind === 'screen')): Promise<Map<string, RecordingCursorSource>> {
  const result = new Map<string, RecordingCursorSource>()
  if (!recording.eventPages.length || !recording.source) return result
  // 每段事件时钟偏移（会话时钟 − recordingUs）连同这段的最后一个事件；暂停只改变偏移。
  const pages: RecordingCursorSource['pages'] = [], offsets: Array<{ lastUs: number; offset: number }> = []
  let owner: RecordingCursorSource['ownerRef'] | undefined, sourceDigest = '', lastMono = -1
  for (const ref of recording.eventPages) {
    signal.throwIfAborted()
    const bytes = await getPlatform().system.fs.readFile(ref.path, { maxBytes: 2 * 1024 * 1024 })
    signal.throwIfAborted()
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(v => v.toString(16).padStart(2, '0')).join('')
    if (!ref.path.replaceAll('\\', '/').endsWith(`-${hash}.capture.json`)) throw new Error('录制事件页校验失败，请恢复原日志。')
    const page = captureLogPageSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
    if (page.ownerRef.kind !== 'screen_recording.session' || page.ownerRef.id !== recording.sessionId || page.seqSpan[0] !== ref.firstSequence || page.seqSpan[1] !== ref.lastSequence || page.monoSpanUs[0] < lastMono || owner && (page.ownerRef.id !== owner.id || page.sourceDigest !== sourceDigest)) throw new Error('录制事件页归属或顺序不符。')
    owner = page.ownerRef; sourceDigest = page.sourceDigest; lastMono = page.monoSpanUs[1]
    pages.push(recordingCursorPageReference(page, ref.path, hash))
    for (const event of page.entries) {
      onEvent?.(event)
      const offset = event.monoUs - event.recordingUs
      if (offsets.at(-1)?.offset !== offset) offsets.push({ lastUs: event.monoUs, offset }); else offsets.at(-1)!.lastUs = event.monoUs
    }
  }
  for (const item of media) {
    // 恢复后的画面比事件时钟先起来：素材第一帧落在暂停里，用它之后第一段事件的偏移，而不是暂停前那段。
    const anchor = offsets.find(value => value.lastUs >= item.monoUs) ?? offsets.at(-1)
    if (!anchor) throw new Error('录制事件页没有时钟信息。')
    result.set(item.id, recordingCursorSourceSchema.parse({ ownerRef: owner, sourceDigest, cursorBakedIn: recording.source.cursorEmbedded, recordingStartUs: Math.max(0, item.monoUs - anchor.offset), width: recording.source.options.width, height: recording.source.options.height, pages }))
  }
  return result
}
