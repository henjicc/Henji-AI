import { CaptureLogCollector } from '../core/captureLog/collector'
import type { CaptureLogPage } from '../core/captureLog/events'
import { recordingCursorPageReference, type RecordingCursorSource } from '../core/videoEdit/recordingCursor'

/** windows：0 秒时前台窗口 editor 在 (100,100) 800×600，2 秒时移到 (400,200) 并变成 1200×600（录屏窗口跟踪用）。 */
export async function recordingCursorFixture(seconds = 4, options: { windows?: boolean } = {}): Promise<{ pages: CaptureLogPage[]; source: RecordingCursorSource; bytes: Map<string, Uint8Array> }> {
  const pages: CaptureLogPage[] = []; let id = 0
  const source: RecordingCursorSource = { ownerRef: { kind: 'recording_session', id: 'cursor-fixture' }, sourceDigest: `sha256:${'a'.repeat(64)}`, recordingStartUs: 0, cursorBakedIn: false, width: 1920, height: 1080, pages: [] }
  const collector = new CaptureLogCollector({ ...source, originUs: 0, id: () => String(++id) }, async page => { pages.push(page) }, error => { throw error })
  collector.start(0)
  for (let i = 0; i < seconds * 120; i++) {
    const at = Math.round(i * 1_000_000 / 120)
    if (options.windows && i === 0) collector.record(at, { kind: 'window', windowId: 'editor', bounds: { x: 100, y: 100, width: 800, height: 600 }, available: true })
    if (options.windows && i === 240) collector.record(at, { kind: 'window', windowId: 'editor', bounds: { x: 400, y: 200, width: 1200, height: 600 }, available: true })
    collector.record(at, { kind: 'cursor', point: [100 + at / 10000, 300], shape: i > 240 ? 'text' : 'arrow' })
    if (i === 120) collector.record(at, { kind: 'click', point: [200, 300], button: 'left', phase: 'down' })
    if (i === 126) collector.record(at, { kind: 'click', point: [205, 300], button: 'left', phase: 'up' })
    if (i % 240 === 239) await collector.flush()
  }
  await collector.stop(seconds * 1_000_000)
  const bytes = new Map<string, Uint8Array>()
  for (const [index, page] of pages.entries()) {
    const data = new TextEncoder().encode(JSON.stringify(page))
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('')
    const path = `henji-media://local/page-${index}.capture.json`
    bytes.set(path, data); source.pages.push(recordingCursorPageReference(page, path, hash))
  }
  return { pages, source, bytes }
}
