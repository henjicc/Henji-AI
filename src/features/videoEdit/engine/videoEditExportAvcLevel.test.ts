import { expect, it } from 'vitest'
import { videoEditExportAvcLevel } from './videoEditExportAvcLevel'

const record = (level: number, lengthSize = 4): Uint8Array =>
  new Uint8Array([1, 100, 0, level, 252 | (lengthSize - 1), 225, 0, 5, 103, 100, 0, level, 128, 1, 0, 2, 104, 128])

it('4K60 repairs avcC, decoder codec and all in-band SPS while preserving slices and source metadata', () => {
  const patch = videoEditExportAvcLevel(52)
  const original = record(51)
  const meta: EncodedVideoChunkMetadata = { decoderConfig: { codec: 'avc1.640033', description: original } }
  const packet = { data: new Uint8Array([0, 0, 0, 5, 103, 100, 0, 51, 128, 0, 0, 0, 3, 101, 4, 9]) }
  patch(packet, meta)
  const result = meta.decoderConfig!.description as Uint8Array
  expect(result[3]).toBe(52)
  expect(result[11]).toBe(52)
  expect(original[3]).toBe(51)
  expect(original[11]).toBe(51)
  expect(meta.decoderConfig!.codec).toBe('avc1.640034')
  expect([...packet.data]).toEqual([0, 0, 0, 5, 103, 100, 0, 52, 128, 0, 0, 0, 3, 101, 4, 9])
})

it('respects description byte offsets, remembers NAL length size, and never downgrades a higher level', () => {
  const patch = videoEditExportAvcLevel(52)
  const padded = new Uint8Array(24)
  padded.set(record(61, 2), 3)
  const meta: EncodedVideoChunkMetadata = { decoderConfig: { codec: 'avc1.64003d', description: padded.subarray(3, 21) } }
  patch({ data: new Uint8Array([0, 2, 101, 128]) }, meta)
  expect(meta.decoderConfig!.codec).toBe('avc1.64003d')
  expect((meta.decoderConfig!.description as Uint8Array)[11]).toBe(61)
  const next = { data: new Uint8Array([0, 5, 103, 100, 0, 51, 128]) }
  patch(next)
  expect(next.data[5]).toBe(52)
})

it('rejects truncated records and packets instead of muxing corrupt data', () => {
  const patch = videoEditExportAvcLevel(52)
  expect(() => patch({ data: new Uint8Array() }, { decoderConfig: { codec: 'avc1.640033', description: record(51).subarray(0, 10) } })).toThrow('SPS')
  expect(() => patch({ data: new Uint8Array([0, 0, 0, 5, 103]) })).toThrow('长度无效')
})
