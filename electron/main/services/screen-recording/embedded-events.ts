import { gunzipSync, gzipSync } from 'node:zlib'
import { open, appendFile } from 'node:fs/promises'
import { z } from 'zod'

/**
 * Recording facts that travel inside a quick-mode MP4 as one top-level `uuid` box.
 * Players skip unknown top-level boxes, so the video stays a normal file; Henji can read the
 * pointer path back. Any re-encode by another program drops the box, which is acceptable.
 */
export const RECORDING_EVENTS_BOX_UUID = Buffer.from('6b8f2a1c4d3e4f5a9b0c7d1e2f3a4b5c', 'hex')
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024

/** Compact rows: [outputMs, kind, ...fields]; points are output pixels of the video frame. */
export const embeddedRecordingEventsSchema = z.object({
  format: z.literal('henji.recording-events'),
  version: z.literal(1),
  video: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), durationMs: z.number().nonnegative() }).strict(),
  /** The system pointer is already drawn into the picture; never draw a second one on top. */
  cursorEmbedded: z.boolean(),
  events: z.array(z.union([
    z.tuple([z.number(), z.literal('cursor'), z.number().nullable(), z.number().nullable(), z.string()]),
    z.tuple([z.number(), z.literal('click'), z.number(), z.number(), z.string(), z.string()]),
    z.tuple([z.number(), z.literal('scroll'), z.number(), z.number(), z.string(), z.number()]),
    z.tuple([z.number(), z.literal('key'), z.string()]),
    z.tuple([z.number(), z.literal('mark'), z.string()]),
  ])),
}).strict()
export type EmbeddedRecordingEvents = z.infer<typeof embeddedRecordingEventsSchema>

export function encodeRecordingEventsBox(payload: EmbeddedRecordingEvents): Buffer {
  const body = gzipSync(Buffer.from(JSON.stringify(embeddedRecordingEventsSchema.parse(payload)), 'utf8'))
  if (body.length > MAX_PAYLOAD_BYTES) throw new Error('录制事件过多，无法写入视频文件')
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + 16 + body.length, 0)
  header.write('uuid', 4, 'ascii')
  return Buffer.concat([header, RECORDING_EVENTS_BOX_UUID, body])
}

export async function appendRecordingEventsBox(file: string, payload: EmbeddedRecordingEvents): Promise<void> {
  await appendFile(file, encodeRecordingEventsBox(payload))
}

/** Walks top-level boxes only; returns null for ordinary videos without Henji data. */
export async function readRecordingEventsBox(file: string): Promise<EmbeddedRecordingEvents | null> {
  const handle = await open(file, 'r')
  try {
    const size = (await handle.stat()).size
    const header = Buffer.alloc(32)
    let offset = 0
    while (offset + 8 <= size) {
      await handle.read(header, 0, 32, offset)
      let length = header.readUInt32BE(0)
      const type = header.toString('ascii', 4, 8)
      let headerLength = 8
      if (length === 1) { length = Number(header.readBigUInt64BE(8)); headerLength = 16 }
      else if (length === 0) length = size - offset
      if (length < headerLength || offset + length > size) return null
      if (type === 'uuid' && length >= headerLength + 16 && header.subarray(headerLength, headerLength + 16).equals(RECORDING_EVENTS_BOX_UUID)) {
        const bodyLength = length - headerLength - 16
        if (bodyLength > MAX_PAYLOAD_BYTES) return null
        const body = Buffer.alloc(bodyLength)
        await handle.read(body, 0, bodyLength, offset + headerLength + 16)
        return embeddedRecordingEventsSchema.parse(JSON.parse(gunzipSync(body).toString('utf8')))
      }
      offset += length
    }
    return null
  } finally { await handle.close() }
}
