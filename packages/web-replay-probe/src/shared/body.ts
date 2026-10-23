import type { WireBody } from '../protocol'

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const encoder = new TextEncoder()

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Keeps exact bytes: text only when the bytes decode losslessly as UTF-8. */
export function bytesToWire(bytes: Uint8Array): WireBody {
  try { return { text: decoder.decode(bytes) } } catch { return { base64: bytesToBase64(bytes) } }
}

export function wireToBytes(body: WireBody): Uint8Array<ArrayBuffer> {
  return 'text' in body ? encoder.encode(body.text) : base64ToBytes(body.base64)
}

/** Request bodies the app may pass to fetch. Streams are not replayable request bodies and are rejected. */
export async function requestBodyToWire(body: BodyInit | null | undefined): Promise<WireBody | undefined> {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return { text: body }
  if (body instanceof URLSearchParams) return { text: body.toString() }
  if (body instanceof Blob) return bytesToWire(new Uint8Array(await body.arrayBuffer()))
  if (body instanceof ArrayBuffer) return bytesToWire(new Uint8Array(body))
  if (ArrayBuffer.isView(body)) return bytesToWire(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
  if (body instanceof FormData) return bytesToWire(new Uint8Array(await new Response(body).arrayBuffer()))
  throw new Error('痕迹录制不支持流式请求体')
}
