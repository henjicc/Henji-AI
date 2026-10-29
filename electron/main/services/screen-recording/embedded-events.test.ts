import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { appendRecordingEventsBox, readRecordingEventsBox, RECORDING_EVENTS_BOX_UUID, type EmbeddedRecordingEvents } from './embedded-events'

function payload(events: EmbeddedRecordingEvents['events']): EmbeddedRecordingEvents {
  return { format: 'henji.recording-events', version: 1, video: { width: 1920, height: 1080, fps: 60, durationMs: 1000 }, cursorEmbedded: true, events }
}

it('大事件块流式压缩并读回，保持视频前缀与所有事件完整', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-embedded-'))
  try {
    const file = path.join(root, 'recording.mp4')
    const prefix = Buffer.from([0, 0, 0, 8, 102, 116, 121, 112])
    await fsp.writeFile(file, prefix)
    const events: EmbeddedRecordingEvents['events'] = Array.from({ length: 1100 }, (_, index) => [index, 'mark', randomBytes(65_536).toString('base64')])
    const digest = (rows: EmbeddedRecordingEvents['events']) => {
      const hash = createHash('sha256')
      for (const row of rows) hash.update(JSON.stringify(row))
      return hash.digest('hex')
    }
    await appendRecordingEventsBox(file, payload(events))
    expect((await fsp.stat(file)).size).toBeGreaterThan(64 * 1024 ** 2)
    const restored = await readRecordingEventsBox(file)
    expect(restored?.events.length).toBe(events.length)
    expect(digest(restored!.events)).toBe(digest(events))
    const handle = await fsp.open(file, 'r')
    try {
      const head = Buffer.alloc(prefix.length)
      await handle.read(head, 0, head.length, 0)
      expect(head).toEqual(prefix)
    } finally { await handle.close() }
  } finally { await fsp.rm(root, { recursive: true, force: true }) }
}, 60_000)

it('读取此前写出的 32 位长度事件块', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-embedded-compat-'))
  try {
    const file = path.join(root, 'recording.mp4')
    const data = payload([[1, 'mark', '兼容']])
    const body = gzipSync(JSON.stringify(data))
    const header = Buffer.alloc(24)
    header.writeUInt32BE(header.length + body.length)
    header.write('uuid', 4, 'ascii')
    RECORDING_EVENTS_BOX_UUID.copy(header, 8)
    await fsp.writeFile(file, Buffer.concat([header, body]))
    expect(await readRecordingEventsBox(file)).toEqual(data)
  } finally { await fsp.rm(root, { recursive: true, force: true }) }
})
