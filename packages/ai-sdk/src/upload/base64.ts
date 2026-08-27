import { AiRuntimeError } from '../runtime/AiRuntimeError'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 把字节数组编码成 base64 字符串，不依赖 Node Buffer 或浏览器 btoa。 */
export function toBase64(bytes: Uint8Array): string {
  let encoded = ''
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]
    const second = bytes[offset + 1]
    const third = bytes[offset + 2]
    encoded += BASE64_ALPHABET[first >> 2]
    encoded += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)]
    encoded += second === undefined
      ? '='
      : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]
    encoded += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f]
  }
  return encoded
}

/** `toBase64` 的逆运算，同样不依赖 Buffer 或浏览器 atob。 */
export function fromBase64(base64: string): Uint8Array {
  const normalized = base64.replace(/\s+/g, '')
  if (normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
    throw new AiRuntimeError('invalid_base64', 'Invalid base64 payload')
  }
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((normalized.length / 4) * 3 - padding)
  let output = 0
  for (let offset = 0; offset < normalized.length; offset += 4) {
    const a = decodeBase64Char(normalized[offset])
    const b = decodeBase64Char(normalized[offset + 1])
    const c = normalized[offset + 2] === '=' ? 0 : decodeBase64Char(normalized[offset + 2])
    const d = normalized[offset + 3] === '=' ? 0 : decodeBase64Char(normalized[offset + 3])
    bytes[output++] = (a << 2) | (b >> 4)
    if (output < bytes.length) bytes[output++] = ((b & 0x0f) << 4) | (c >> 2)
    if (output < bytes.length) bytes[output++] = ((c & 0x03) << 6) | d
  }
  return bytes
}

function decodeBase64Char(value: string): number {
  const index = BASE64_ALPHABET.indexOf(value)
  if (index < 0) throw new AiRuntimeError('invalid_base64', 'Invalid base64 payload')
  return index
}

export function toDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${toBase64(bytes)}`
}
