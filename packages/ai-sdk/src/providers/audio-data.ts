import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { toDataUri } from '../upload/base64'

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/L16', flac: 'audio/flac',
  opus: 'audio/opus', ogg: 'audio/ogg',
}

export function audioBytesToDataUri(bytes: Uint8Array, format: string): string {
  if (bytes.byteLength === 0) throw new AiRuntimeError('empty_result', 'Audio response is empty')
  return toDataUri(bytes, MIME_TYPES[format] ?? 'application/octet-stream')
}

export function hexAudioToDataUri(hex: string, format: string): string {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[\da-f]+$/i.test(hex)) {
    throw new AiRuntimeError('invalid_response', 'Audio response is not valid hex')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return audioBytesToDataUri(bytes, format)
}
