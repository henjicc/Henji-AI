import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'

import { AiRuntimeError } from '../../../../runtime/AiRuntimeError'

const PROTOCOL_VERSION = 1
const HEADER_WORDS = 1
const CLIENT_FULL_REQUEST = 0x1
const CLIENT_AUDIO_REQUEST = 0x2
const SERVER_FULL_RESPONSE = 0x9
const SERVER_ERROR_RESPONSE = 0xf
const FLAG_POSITIVE_SEQUENCE = 0x1
const FLAG_LAST = 0x2
const FLAG_EVENT = 0x4
const SERIALIZATION_NONE = 0x0
const SERIALIZATION_JSON = 0x1
const COMPRESSION_NONE = 0x0
const COMPRESSION_GZIP = 0x1

export interface VolcengineResponseFrame {
  kind: 'response'
  sequence?: number
  event?: number
  last: boolean
  payload?: unknown
}

export interface VolcengineErrorFrame {
  kind: 'error'
  code: number
  sequence?: number
  event?: number
  last: boolean
  message: string
  payload?: unknown
}

export type VolcengineServerFrame = VolcengineResponseFrame | VolcengineErrorFrame

function ensureSequence(sequence: number): void {
  if (!Number.isInteger(sequence) || sequence <= 0 || sequence > 0x7fffffff) {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine realtime sequence must be a positive int32')
  }
}

function int32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setInt32(0, value, false)
  return bytes
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function requestHeader(messageType: number, flags: number): Uint8Array {
  return new Uint8Array([
    (PROTOCOL_VERSION << 4) | HEADER_WORDS,
    (messageType << 4) | flags,
    // 火山当前官方附件对 JSON 首帧和原始音频帧都使用 JSON+gzip 标志；音频 payload 仍是原始 PCM 字节。
    (SERIALIZATION_JSON << 4) | COMPRESSION_GZIP,
    0,
  ])
}

export function encodeVolcengineFullRequest(payload: unknown, sequence = 1): Uint8Array {
  ensureSequence(sequence)
  let json: string | undefined
  try { json = JSON.stringify(payload) } catch {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine realtime full request is not JSON serializable')
  }
  if (json === undefined) {
    throw new AiRuntimeError('invalid_parameter', 'Volcengine realtime full request must serialize to JSON')
  }
  const compressed = gzipSync(strToU8(json))
  return join([
    requestHeader(CLIENT_FULL_REQUEST, FLAG_POSITIVE_SEQUENCE),
    int32(sequence),
    uint32(compressed.byteLength),
    compressed,
  ])
}

export function encodeVolcengineAudioRequest(
  audio: Uint8Array,
  sequence: number,
  last: boolean
): Uint8Array {
  ensureSequence(sequence)
  if (audio.byteLength === 0) {
    throw new AiRuntimeError('invalid_audio_chunk', 'Volcengine realtime audio frame cannot be empty')
  }
  const compressed = gzipSync(audio)
  return join([
    requestHeader(
      CLIENT_AUDIO_REQUEST,
      last ? FLAG_POSITIVE_SEQUENCE | FLAG_LAST : FLAG_POSITIVE_SEQUENCE
    ),
    int32(last ? -sequence : sequence),
    uint32(compressed.byteLength),
    compressed,
  ])
}

function requireBytes(bytes: Uint8Array, offset: number, count: number, label: string): void {
  if (offset < 0 || count < 0 || offset + count > bytes.byteLength) {
    throw new AiRuntimeError('invalid_response', `Volcengine realtime frame is truncated before ${label}`)
  }
}

function readInt32(bytes: Uint8Array, offset: number, label: string): number {
  requireBytes(bytes, offset, 4, label)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, false)
}

function readUint32(bytes: Uint8Array, offset: number, label: string): number {
  requireBytes(bytes, offset, 4, label)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
}

function decompress(payload: Uint8Array, compression: number): Uint8Array {
  if (compression === COMPRESSION_NONE) return payload
  if (compression !== COMPRESSION_GZIP) {
    throw new AiRuntimeError(
      'invalid_response',
      `Volcengine realtime frame uses unsupported compression ${compression}`
    )
  }
  try { return gunzipSync(payload) } catch {
    throw new AiRuntimeError('invalid_response', 'Volcengine realtime frame contains invalid gzip payload')
  }
}

function deserialize(payload: Uint8Array, serialization: number): unknown {
  if (serialization === SERIALIZATION_NONE) return payload
  if (serialization !== SERIALIZATION_JSON) {
    throw new AiRuntimeError(
      'invalid_response',
      `Volcengine realtime frame uses unsupported serialization ${serialization}`
    )
  }
  try { return JSON.parse(strFromU8(payload)) } catch {
    throw new AiRuntimeError('invalid_response', 'Volcengine realtime frame contains invalid JSON payload')
  }
}

function deserializeError(payload: Uint8Array, serialization: number): unknown {
  if (serialization === SERIALIZATION_NONE) return payload
  if (serialization !== SERIALIZATION_JSON) {
    throw new AiRuntimeError(
      'invalid_response',
      `Volcengine realtime frame uses unsupported serialization ${serialization}`
    )
  }
  const text = strFromU8(payload)
  try { return JSON.parse(text) } catch { return text }
}

function errorMessage(payload: unknown, raw: Uint8Array): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const root = payload as Record<string, unknown>
    for (const key of ['message', 'error', 'msg']) {
      const value = root[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  if (typeof payload === 'string' && payload.trim()) return payload.trim()
  const text = strFromU8(raw).trim()
  return text || 'Volcengine realtime server returned an error'
}

/** 严格解析火山 v1 服务端帧；长度字段必须与实际 payload 完全一致。 */
export function parseVolcengineServerFrame(bytes: Uint8Array): VolcengineServerFrame {
  requireBytes(bytes, 0, 4, 'header')
  const version = bytes[0] >> 4
  const headerWords = bytes[0] & 0x0f
  if (version !== PROTOCOL_VERSION) {
    throw new AiRuntimeError('invalid_response', `Unsupported Volcengine realtime protocol version ${version}`)
  }
  if (headerWords < 1) {
    throw new AiRuntimeError('invalid_response', 'Volcengine realtime header size must be at least one word')
  }
  const headerBytes = headerWords * 4
  requireBytes(bytes, 0, headerBytes, 'extended header')
  const messageType = bytes[1] >> 4
  const flags = bytes[1] & 0x0f
  if ((flags & ~0x07) !== 0) {
    throw new AiRuntimeError('invalid_response', `Volcengine realtime frame uses unsupported flags ${flags}`)
  }
  const serialization = bytes[2] >> 4
  const compression = bytes[2] & 0x0f
  if (serialization !== SERIALIZATION_NONE && serialization !== SERIALIZATION_JSON) {
    throw new AiRuntimeError(
      'invalid_response',
      `Volcengine realtime frame uses unsupported serialization ${serialization}`
    )
  }
  if (compression !== COMPRESSION_NONE && compression !== COMPRESSION_GZIP) {
    throw new AiRuntimeError(
      'invalid_response',
      `Volcengine realtime frame uses unsupported compression ${compression}`
    )
  }
  let offset = headerBytes
  let sequence: number | undefined
  let event: number | undefined
  if ((flags & FLAG_POSITIVE_SEQUENCE) !== 0) {
    sequence = readInt32(bytes, offset, 'sequence')
    offset += 4
  }
  if ((flags & FLAG_EVENT) !== 0) {
    event = readInt32(bytes, offset, 'event')
    offset += 4
  }
  let code: number | undefined
  if (messageType === SERVER_ERROR_RESPONSE) {
    code = readUint32(bytes, offset, 'error code')
    offset += 4
  } else if (messageType !== SERVER_FULL_RESPONSE) {
    throw new AiRuntimeError(
      'invalid_response',
      `Unsupported Volcengine realtime server message type ${messageType}`
    )
  }
  const payloadSize = readUint32(bytes, offset, 'payload size')
  offset += 4
  const actualSize = bytes.byteLength - offset
  if (actualSize !== payloadSize) {
    throw new AiRuntimeError(
      'invalid_response',
      `Volcengine realtime payload length mismatch: expected ${payloadSize}, got ${actualSize}`
    )
  }
  const compressedPayload = bytes.subarray(offset)
  const raw = payloadSize ? decompress(compressedPayload, compression) : new Uint8Array()
  const payload = raw.byteLength
    ? messageType === SERVER_ERROR_RESPONSE
      ? deserializeError(raw, serialization)
      : deserialize(raw, serialization)
    : undefined
  const common = {
    sequence,
    event,
    last: (flags & FLAG_LAST) !== 0,
  }
  if (messageType === SERVER_ERROR_RESPONSE) {
    return {
      kind: 'error',
      code: code as number,
      ...common,
      message: errorMessage(payload, raw),
      payload,
    }
  }
  return { kind: 'response', ...common, payload }
}
