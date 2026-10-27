import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('../appPaths', () => ({ getUserFolderDir: vi.fn(() => { throw new Error('测试必须显式传目录') }) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
import { embeddedRecordingEditSource, embeddedRecordingPayloads } from './embedded-import'
import { appendRecordingEventsBox, type EmbeddedRecordingEvents } from './embedded-events'
import { RecordingEventStore } from './event-store'
import { sampleRecordingCursor } from '../../../../src/core/videoEdit/recordingCursor'

const root = mkdtempSync(path.join(tmpdir(), 'henji-embedded-import-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
/** A minimal top-level box layout: what matters is that the reader walks past ordinary boxes to the Henji one. */
function video(name: string): string {
  const file = path.join(root, name)
  const ftyp = Buffer.alloc(16); ftyp.writeUInt32BE(16, 0); ftyp.write('ftyp', 4, 'ascii'); ftyp.write('isom', 8, 'ascii')
  const mdat = Buffer.alloc(24); mdat.writeUInt32BE(24, 0); mdat.write('mdat', 4, 'ascii')
  writeFileSync(file, Buffer.concat([ftyp, mdat]))
  return file
}
const payload: EmbeddedRecordingEvents = {
  format: 'henji.recording-events', version: 1, video: { width: 1920, height: 1080, fps: 60, durationMs: 4000 }, cursorEmbedded: true,
  events: [
    [0, 'cursor', 100, 100, 'arrow'], [500, 'cursor', 400, 300, 'arrow'], [1000, 'click', 400, 300, 'left', 'down'], [1080, 'click', 400, 300, 'left', 'up'],
    [1500, 'cursor', null, null, 'hidden'], [2000, 'scroll', 400, 300, 'vertical', -120], [2500, 'key', 'typing'], [3000, 'mark', '重点'],
    [3200, 'click', 10, 10, 'thumb', 'down'],
  ],
}

describe('快速模式视频再导入剪辑', () => {
  it('把文件里的事件行换成采集事件，读不懂的行丢弃而不是猜', () => {
    const rows = embeddedRecordingPayloads(payload)
    expect(rows.map(row => row.payload.kind)).toEqual(['cursor', 'cursor', 'click', 'click', 'cursor', 'scroll', 'key', 'mark'])
    expect(rows[2]).toEqual({ videoUs: 1_000_000, payload: { kind: 'click', point: [400, 300], button: 'left', phase: 'down' } })
    expect(rows[4].payload).toEqual({ kind: 'cursor', point: null, shape: 'hidden' })
  })

  it('带事件盒的视频绑定为录屏片段：光标已在画面里只画点击，事件页按内容寻址、重复导入复用', async () => {
    const file = video('quick.mp4')
    await appendRecordingEventsBox(file, payload)
    const directory = path.join(root, 'events')
    const source = await embeddedRecordingEditSource(file, directory)
    expect(source).not.toBeNull()
    expect(source!.cursor).toMatchObject({ cursorBakedIn: true, recordingStartUs: 0, width: 1920, height: 1080 })
    expect(source!.cursor.ownerRef.kind).toBe('screen_recording.video_file')
    expect(source!.events.map(event => [event.kind, event.recordingUs])).toEqual([['click', 1_000_000], ['click', 1_080_000], ['key', 2_500_000]])
    const pages = []
    for await (const page of new RecordingEventStore(path.dirname(source!.cursor.pages[0].path)).recover()) pages.push(page)
    const events = pages.flatMap(page => page.entries)
    // Pointer already drawn into the picture: sampling yields the click ring only, never a second pointer.
    const frame = sampleRecordingCursor(events, 1_100_000, { smoothing: 0, hideAfterSeconds: 0, cursorBakedIn: source!.cursor.cursorBakedIn })
    expect(frame.cursor).toBeUndefined()
    expect(frame.clicks).toEqual([expect.objectContaining({ point: [400, 300], button: 'left' })])
    const again = await embeddedRecordingEditSource(file, directory)
    expect(again!.cursor).toEqual(source!.cursor)
    expect(readdirSync(directory)).toHaveLength(1)
  })

  it('普通视频与没有指针事件的事件盒不绑定', async () => {
    expect(await embeddedRecordingEditSource(video('plain.mp4'), path.join(root, 'none'))).toBeNull()
    const marksOnly = video('marks.mp4')
    await appendRecordingEventsBox(marksOnly, { ...payload, events: [[100, 'mark', '只有标记']] })
    expect(await embeddedRecordingEditSource(marksOnly, path.join(root, 'none'))).toBeNull()
  })
})
