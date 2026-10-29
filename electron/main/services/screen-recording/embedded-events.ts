import { createGunzip, createGzip } from 'node:zlib'
import { open } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { jsonChunks, readJsonStream } from '../fs/json-file'

/**
 * Recording facts that travel inside a quick-mode MP4 as one top-level `uuid` box.
 * Players skip unknown top-level boxes, so the video stays a normal file; Henji can read the
 * pointer path back. Any re-encode by another program drops the box, which is acceptable.
 */
export const RECORDING_EVENTS_BOX_UUID = Buffer.from('6b8f2a1c4d3e4f5a9b0c7d1e2f3a4b5c', 'hex')

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

export async function appendRecordingEventsBox(file: string, payload: EmbeddedRecordingEvents): Promise<void> {
  const validated = embeddedRecordingEventsSchema.parse(payload)
  const handle = await open(file, 'r+')
  const originalSize = (await handle.stat()).size
  try {
    // MP4 的扩展长度头允许大事件块；正文分块压缩，完成后才补写长度。
    const header = Buffer.alloc(32)
    header.writeUInt32BE(1, 0)
    header.write('uuid', 4, 'ascii')
    RECORDING_EVENTS_BOX_UUID.copy(header, 16)
    await pipeline(jsonChunks(validated), createGzip(), createWriteStream(file, { flags: 'r+', start: originalSize + header.length }))
    const length = (await handle.stat()).size - originalSize
    header.writeBigUInt64BE(BigInt(length), 8)
    await handle.write(header, 0, header.length, originalSize)
  } catch (error) {
    await handle.truncate(originalSize)
    throw error
  } finally { await handle.close() }
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
      if (!Number.isSafeInteger(length) || length < headerLength || offset + length > size) return null
      if (type === 'uuid' && length >= headerLength + 16 && header.subarray(headerLength, headerLength + 16).equals(RECORDING_EVENTS_BOX_UUID)) {
        const bodyLength = length - headerLength - 16
        if (bodyLength === 0) return null
        const raw = await pipeline(createReadStream(file, { start: offset + headerLength + 16, end: offset + length - 1 }), createGunzip(), async chunks => readJsonStream(chunks))
        return embeddedRecordingEventsSchema.parse(raw)
      }
      offset += length
    }
    return null
  } finally { await handle.close() }
}
