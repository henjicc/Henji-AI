import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CaptureLogCollector } from '../../../../src/core/captureLog/collector'
import { captureEventSchema, cursorShapes, type CaptureEvent, type CaptureLogPage, type CapturePayload } from '../../../../src/core/captureLog/events'
import { recordingCursorPageReference, recordingCursorSourceSchema, type RecordingCursorSource } from '../../../../src/core/videoEdit/recordingCursor'
import { getUserFolderDir } from '../appPaths'
import { createMainLogger } from '../logging'
import { RecordingEventStore } from './event-store'
import { readRecordingEventsBox, type EmbeddedRecordingEvents } from './embedded-events'

const logger = createMainLogger('main.screen_recording.embedded_import')
/** Bumped when the projection changes, so pages written by an older projection are rebuilt. */
const PROJECTION_VERSION = 1
const PAGE_NAME = /^\d{16}-[a-f0-9]{64}\.capture\.json$/
type CursorShape = typeof cursorShapes[number]

/** Rows of the file box → capture payloads on the video clock (µs). A row this version cannot read is skipped, never guessed. */
export function embeddedRecordingPayloads(payload: EmbeddedRecordingEvents): Array<{ videoUs: number; payload: CapturePayload }> {
  const result: Array<{ videoUs: number; payload: CapturePayload }> = []
  const shapes = new Set<string>(cursorShapes)
  for (const row of [...payload.events].sort((a, b) => a[0] - b[0])) {
    const videoUs = Math.max(0, Math.round(row[0] * 1000))
    const value = row[1] === 'cursor' ? { kind: 'cursor', point: row[2] === null || row[3] === null ? null : [row[2], row[3]], shape: shapes.has(row[4]) ? row[4] as CursorShape : 'unknown' }
      : row[1] === 'click' ? { kind: 'click', point: [row[2], row[3]], button: row[4], phase: row[5] }
        : row[1] === 'scroll' ? { kind: 'scroll', point: [row[2], row[3]], axis: row[4], amount: row[5] }
          : row[1] === 'key' ? { kind: 'key', category: row[2] }
            : { kind: 'mark', ...(row[2] ? { note: row[2].slice(0, 4000) } : {}) }
    // Same schema as live capture: an unknown button, axis or key category drops the row.
    const checked = captureEventSchema.safeParse({ ...value, eventId: 'e', seq: 0, monoUs: videoUs, recordingUs: videoUs, timeline: null, clockSegmentRef: 'c', unavailableReason: 'static' })
    if (!checked.success) continue
    const { eventId: _eventId, seq: _seq, monoUs: _monoUs, recordingUs: _recordingUs, timeline: _timeline, clockSegmentRef: _clock, unavailableReason: _reason, ...event } = checked.data
    result.push({ videoUs, payload: event as CapturePayload })
  }
  return result
}

async function readPages(directory: string): Promise<CaptureLogPage[]> {
  const pages: CaptureLogPage[] = []
  for await (const page of new RecordingEventStore(directory).recover()) pages.push(page)
  return pages
}

export interface EmbeddedRecordingEditSource {
  cursor: RecordingCursorSource
  /** Click and key events on the video clock, for suggesting zoom regions. */
  events: CaptureEvent[]
}

export function embeddedRecordingEventsDirectory(): string { return path.join(getUserFolderDir('uploads'), 'screen-recordings', 'video-events') }

/**
 * A quick-mode MP4 brought back into an edit: the pointer facts written into the file become capture-log pages,
 * so the clip is a recording clip again (zoom and click effects; a pointer already in the picture is never drawn twice).
 * Pages come only from the file's own box and are stored by its digest: the same video always gives the same
 * pages, and re-importing reuses them. Ordinary videos, and videos whose box has no pointer facts, return null.
 */
export async function embeddedRecordingEditSource(file: string, directory = embeddedRecordingEventsDirectory()): Promise<EmbeddedRecordingEditSource | null> {
  const payload = await readRecordingEventsBox(file)
  if (!payload) return null
  const projected = embeddedRecordingPayloads(payload)
  if (!projected.some(event => event.payload.kind === 'cursor' || event.payload.kind === 'click')) return null
  const digest = createHash('sha256').update(JSON.stringify(payload)).update(`\0projection-v${PROJECTION_VERSION}`).digest('hex')
  const ownerRef = { kind: 'screen_recording.video_file', id: digest.slice(0, 32) }
  const sourceDigest = `sha256:${digest}`
  const pagesDirectory = path.join(directory, digest.slice(0, 32))
  let pages = await readPages(pagesDirectory).catch(() => [] as CaptureLogPage[])
  if (!pages.length || pages[0].sourceDigest !== sourceDigest) {
    await fs.rm(pagesDirectory, { recursive: true, force: true })
    await fs.mkdir(pagesDirectory, { recursive: true })
    const store = new RecordingEventStore(pagesDirectory)
    let sequence = 0
    // Deterministic ids: the same file always gives the same page bytes, so edits keep matching hashes.
    const collector = new CaptureLogCollector({ ownerRef, sourceDigest, originUs: 0, id: () => `e${sequence++}` }, async page => { await store.write(page) }, error => logger.warn('视频内录制事件页写入积压', { event: 'recording.embedded_import.pressure', error: String(error) }))
    collector.start(0)
    for (const event of projected) collector.record(event.videoUs, event.payload)
    await collector.stop(Math.max(Math.round(payload.video.durationMs * 1000), projected.at(-1)!.videoUs))
    pages = await readPages(pagesDirectory)
    logger.info('视频内录制事件已转为剪辑事件页', { event: 'recording.embedded_import.projected', context: { events: projected.length, pages: pages.length } })
  }
  const names = (await fs.readdir(pagesDirectory)).filter(name => PAGE_NAME.test(name)).sort()
  if (names.length !== pages.length) throw new Error('视频内录制事件页不完整，请重新导入')
  return {
    cursor: recordingCursorSourceSchema.parse({
      ownerRef, sourceDigest, cursorBakedIn: payload.cursorEmbedded, recordingStartUs: 0, width: payload.video.width, height: payload.video.height,
      pages: pages.map((page, index) => recordingCursorPageReference(page, path.join(pagesDirectory, names[index]), names[index].slice(17, 81))),
    }),
    events: pages.flatMap(page => page.entries.filter(entry => entry.kind === 'click' || entry.kind === 'key')),
  }
}
