/**
 * The smallest Matroska stream FFmpeg reads raw frames (BGRA or NV12) from, each with its own timestamp. The
 * replay sends a frame only when the picture changed; FFmpeg (`-fps_mode cfr`) repeats it until the next
 * one, so an unchanged screen costs no pipe bandwidth (a 4K frame is 38 MB). Spec: RFC 9559 (Matroska)
 * and RFC 8794 (EBML); FFmpeg maps the V_UNCOMPRESSED FourCCs "BGRA" and "NV12" to its bgra and nv12 formats.
 */

const UNKNOWN_SIZE = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])

/** EBML variable-size integer, 8 bytes (always valid, never the reserved all-ones value below 2^56 - 1). */
function size8(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** 56 - 1) throw new Error(`EBML size out of range: ${value}`)
  const out = Buffer.alloc(8)
  out[0] = 0x01
  let rest = value
  for (let i = 7; i >= 1; i -= 1) { out[i] = rest % 256; rest = Math.floor(rest / 256) }
  return out
}

function uint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`EBML uint out of range: ${value}`)
  const bytes: number[] = []
  let rest = value
  do { bytes.unshift(rest % 256); rest = Math.floor(rest / 256) } while (rest > 0)
  return Buffer.from(bytes)
}

function element(id: number[], data: Buffer | Buffer[]): Buffer {
  const body = Array.isArray(data) ? Buffer.concat(data) : data
  return Buffer.concat([Buffer.from(id), size8(body.length), body])
}

const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3], ebmlVersion: [0x42, 0x86], ebmlReadVersion: [0x42, 0xf7], maxIdLength: [0x42, 0xf2], maxSizeLength: [0x42, 0xf3],
  docType: [0x42, 0x82], docTypeVersion: [0x42, 0x87], docTypeReadVersion: [0x42, 0x85],
  segment: [0x18, 0x53, 0x80, 0x67], info: [0x15, 0x49, 0xa9, 0x66], timestampScale: [0x2a, 0xd7, 0xb1], muxingApp: [0x4d, 0x80], writingApp: [0x57, 0x41],
  tracks: [0x16, 0x54, 0xae, 0x6b], trackEntry: [0xae], trackNumber: [0xd7], trackUid: [0x73, 0xc5], trackType: [0x83], flagLacing: [0x9c],
  codecId: [0x86], defaultDuration: [0x23, 0xe3, 0x83], video: [0xe0], pixelWidth: [0xb0], pixelHeight: [0xba], fourCC: [0x2e, 0xb5, 0x24],
  cluster: [0x1f, 0x43, 0xb6, 0x75], timestamp: [0xe7], simpleBlock: [0xa3],
} as const

/** Timestamps are in microseconds. */
export const MATROSKA_TIMESTAMP_SCALE_NS = 1000

export type RawPixelFormat = 'bgra' | 'nv12'

/** EBML header, an open-ended Segment, Info and one raw video track. */
export function rawMatroskaHeader(width: number, height: number, fps: number, format: RawPixelFormat = 'bgra'): Buffer {
  const ebml = element([...ID.ebml], [
    element([...ID.ebmlVersion], uint(1)), element([...ID.ebmlReadVersion], uint(1)), element([...ID.maxIdLength], uint(4)), element([...ID.maxSizeLength], uint(8)),
    element([...ID.docType], Buffer.from('matroska')), element([...ID.docTypeVersion], uint(4)), element([...ID.docTypeReadVersion], uint(2)),
  ])
  const info = element([...ID.info], [
    element([...ID.timestampScale], uint(MATROSKA_TIMESTAMP_SCALE_NS)), element([...ID.muxingApp], Buffer.from('henji-web-replay')), element([...ID.writingApp], Buffer.from('henji-web-replay')),
  ])
  const tracks = element([...ID.tracks], element([...ID.trackEntry], [
    element([...ID.trackNumber], uint(1)), element([...ID.trackUid], uint(1)), element([...ID.trackType], uint(1)), element([...ID.flagLacing], uint(0)),
    element([...ID.codecId], Buffer.from('V_UNCOMPRESSED')), element([...ID.defaultDuration], uint(Math.round(1e9 / fps))),
    element([...ID.video], [element([...ID.pixelWidth], uint(width)), element([...ID.pixelHeight], uint(height)), element([...ID.fourCC], Buffer.from(format === 'nv12' ? 'NV12' : 'BGRA'))]),
  ]))
  return Buffer.concat([ebml, Buffer.from(ID.segment), UNKNOWN_SIZE, info, tracks])
}

/**
 * Bytes that precede one frame's pixels: a Cluster holding its timestamp and a single keyframe
 * SimpleBlock. Write the returned header, then exactly `frameBytes` of pixels.
 */
export function rawMatroskaFrameHeader(timestampUs: number, frameBytes: number): Buffer {
  const timestamp = element([...ID.timestamp], uint(Math.round(timestampUs)))
  // SimpleBlock: track 1 (vint 0x81), relative timestamp 0 (int16), flags: keyframe.
  const blockHead = Buffer.from([0x81, 0x00, 0x00, 0x80])
  const blockHeader = Buffer.concat([Buffer.from(ID.simpleBlock), size8(blockHead.length + frameBytes), blockHead])
  const clusterBody = timestamp.length + blockHeader.length + frameBytes
  return Buffer.concat([Buffer.from(ID.cluster), size8(clusterBody), timestamp, blockHeader])
}
