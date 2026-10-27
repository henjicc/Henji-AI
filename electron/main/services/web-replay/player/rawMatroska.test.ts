import { expect, it } from 'vitest'
import { rawMatroskaFrameHeader, rawMatroskaHeader } from './rawMatroska'

/** Minimal EBML reader for the elements the writer emits (8-byte sizes, or the unknown size). */
function readElement(buffer: Buffer, offset: number): { id: string; size: number; data: number; end: number } {
  const first = buffer[offset]
  const idLength = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : 4
  const id = buffer.subarray(offset, offset + idLength).toString('hex')
  const sizeAt = offset + idLength
  expect(buffer[sizeAt]).toBe(0x01)
  const raw = buffer.subarray(sizeAt + 1, sizeAt + 8)
  const unknown = raw.every(byte => byte === 0xff)
  const size = unknown ? Infinity : raw.reduce((value, byte) => value * 256 + byte, 0)
  const data = sizeAt + 8
  return { id, size, data, end: unknown ? buffer.length : data + size }
}

it('头部是 EBML、长度未知的 Segment、Info（微秒时间刻度）与一条 BGRA 原始视频轨', () => {
  const header = rawMatroskaHeader(3840, 2462, 60)
  const ebml = readElement(header, 0)
  expect(ebml.id).toBe('1a45dfa3')
  expect(header.subarray(ebml.data, ebml.end).includes(Buffer.from('matroska'))).toBe(true)
  const segment = readElement(header, ebml.end)
  expect(segment.id).toBe('18538067')
  expect(segment.size).toBe(Infinity)
  const info = readElement(header, segment.data)
  expect(info.id).toBe('1549a966')
  const tracks = readElement(header, info.end)
  expect(tracks.id).toBe('1654ae6b')
  expect(tracks.end).toBe(header.length)
  const body = header.subarray(tracks.data, tracks.end)
  expect(body.includes(Buffer.from('V_UNCOMPRESSED'))).toBe(true)
  expect(body.includes(Buffer.from('BGRA'))).toBe(true)
  // PixelWidth 3840 = 0x0f00, PixelHeight 2462 = 0x099e
  expect(body.includes(Buffer.from([0xb0, 0x01, 0, 0, 0, 0, 0, 0, 0x02, 0x0f, 0x00]))).toBe(true)
  expect(body.includes(Buffer.from([0xba, 0x01, 0, 0, 0, 0, 0, 0, 0x02, 0x09, 0x9e]))).toBe(true)
})

it('每帧一个 Cluster：时间戳（微秒，四舍五入）加一个关键帧 SimpleBlock，长度刚好装下像素', () => {
  const pixels = Buffer.alloc(64)
  const head = rawMatroskaFrameHeader(1e6 / 60, pixels.length)
  const stream = Buffer.concat([head, pixels])
  const cluster = readElement(stream, 0)
  expect(cluster.id).toBe('1f43b675')
  expect(cluster.end).toBe(stream.length)
  const timestamp = readElement(stream, cluster.data)
  expect(timestamp.id).toBe('e7')
  expect(stream.subarray(timestamp.data, timestamp.end).readUIntBE(0, timestamp.size)).toBe(16667)
  const block = readElement(stream, timestamp.end)
  expect(block.id).toBe('a3')
  expect(block.end).toBe(stream.length)
  expect([...stream.subarray(block.data, block.data + 4)]).toEqual([0x81, 0, 0, 0x80])
  expect(block.size).toBe(4 + pixels.length)
})

it('NV12 轨用 FourCC NV12', () => {
  expect(rawMatroskaHeader(64, 32, 60, 'nv12').includes(Buffer.from('NV12'))).toBe(true)
  expect(rawMatroskaHeader(64, 32, 60, 'nv12').includes(Buffer.from('BGRA'))).toBe(false)
})
