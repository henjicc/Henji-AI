import { CaptureLogCollector } from '../core/captureLog/collector'
import type { CaptureLogPage } from '../core/captureLog/events'
import { recordingCursorPageReference, type RecordingCursorSource } from '../core/videoEdit/recordingCursor'

export async function screenAttentionFixture(options: { capability?: boolean } = {}): Promise<{ source: RecordingCursorSource; bytes: Map<string, Uint8Array> }> {
  const pages: CaptureLogPage[] = []; let id = 0
  const source: RecordingCursorSource = { ownerRef: { kind: 'recording_session', id: 'attention-fixture' }, sourceDigest: `sha256:${'c'.repeat(64)}`, recordingStartUs: 0, cursorBakedIn: false, width: 1920, height: 1080, pages: [] }
  const collector = new CaptureLogCollector({ ...source, originUs: 0, id: () => String(++id) }, async page => { pages.push(page) }, error => { throw error })
  collector.start(0)
  for (const [time, point] of [[1_000_000, [400, 400]], [4_000_000, [1520, 680]]] as const) {
    collector.record(time, { kind: 'click', phase: 'down', button: 'left', point: [...point] })
    collector.record(time + 50000, { kind: 'click', phase: 'up', button: 'left', point: [...point] })
    if (options.capability && time === 1_000_000) collector.record(1_500_000, { kind: 'capability', callId: 'call', capability: 'sample_operation', targets: [{ kind: 'canvas.node', id: 'target' }], phase: 'started' })
    await collector.flush()
  }
  await collector.stop(10_000_000)
  const bytes = new Map<string, Uint8Array>()
  for (const [index, page] of pages.entries()) {
    const data = new TextEncoder().encode(JSON.stringify(page))
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('')
    const path = `henji-media://local/attention-${index}.capture.json`
    bytes.set(path, data); source.pages.push(recordingCursorPageReference(page, path, hash))
  }
  return { source, bytes }
}
