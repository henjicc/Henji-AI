/** UTF-8 增量解码器的最小契约；不要求宿主提供 DOM `TextDecoder`。 */
export interface Utf8StreamDecoder {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string
}

const REPLACEMENT_CHARACTER = '\uFFFD'
const EMPTY_BYTES = new Uint8Array(0)

/**
 * 创建流式协议共用的 UTF-8 解码器。
 *
 * Photoshop UXP 9.2 没有 `TextDecoder`。这里使用包内实现，避免宿主注入全局 polyfill，
 * 同时保持跨 chunk 多字节字符、畸形序列替换和流结束 flush 的标准行为。
 */
export function createUtf8StreamDecoder(): Utf8StreamDecoder {
  return new PortableUtf8StreamDecoder()
}

/** 导出仅供包内测试；公共入口不重导出这个实现类。 */
export class PortableUtf8StreamDecoder implements Utf8StreamDecoder {
  private pending = EMPTY_BYTES

  decode(input: Uint8Array = EMPTY_BYTES, options: { stream?: boolean } = {}): string {
    const bytes = appendBytes(this.pending, input)
    this.pending = EMPTY_BYTES
    const stream = options.stream === true
    let output = ''
    let offset = 0

    while (offset < bytes.length) {
      const first = bytes[offset]
      if (first <= 0x7f) {
        output += String.fromCharCode(first)
        offset += 1
        continue
      }

      const sequenceLength = readSequenceLength(first)
      if (sequenceLength === 0) {
        output += REPLACEMENT_CHARACTER
        offset += 1
        continue
      }

      if (offset + 1 >= bytes.length) {
        if (stream) this.pending = bytes.slice(offset)
        else output += REPLACEMENT_CHARACTER
        break
      }

      const second = bytes[offset + 1]
      if (!isValidSecondByte(first, second)) {
        output += REPLACEMENT_CHARACTER
        offset += 1
        continue
      }

      let continuationCount = 1
      let invalidContinuation = false
      while (continuationCount < sequenceLength - 1) {
        const nextOffset = offset + 1 + continuationCount
        if (nextOffset >= bytes.length) {
          if (stream) this.pending = bytes.slice(offset)
          else output += REPLACEMENT_CHARACTER
          offset = bytes.length
          invalidContinuation = true
          break
        }
        if (!isContinuationByte(bytes[nextOffset])) {
          output += REPLACEMENT_CHARACTER
          offset += 1 + continuationCount
          invalidContinuation = true
          break
        }
        continuationCount += 1
      }
      if (invalidContinuation) continue

      output += String.fromCodePoint(decodeCodePoint(bytes, offset, sequenceLength))
      offset += sequenceLength
    }

    return output
  }
}

function appendBytes(pending: Uint8Array, input: Uint8Array): Uint8Array {
  if (pending.length === 0) return input
  if (input.length === 0) return pending
  const combined = new Uint8Array(pending.length + input.length)
  combined.set(pending)
  combined.set(input, pending.length)
  return combined
}

function readSequenceLength(first: number): number {
  if (first >= 0xc2 && first <= 0xdf) return 2
  if (first >= 0xe0 && first <= 0xef) return 3
  if (first >= 0xf0 && first <= 0xf4) return 4
  return 0
}

function isContinuationByte(value: number): boolean {
  return value >= 0x80 && value <= 0xbf
}

function isValidSecondByte(first: number, second: number): boolean {
  if (!isContinuationByte(second)) return false
  if (first === 0xe0) return second >= 0xa0
  if (first === 0xed) return second <= 0x9f
  if (first === 0xf0) return second >= 0x90
  if (first === 0xf4) return second <= 0x8f
  return true
}

function decodeCodePoint(bytes: Uint8Array, offset: number, length: number): number {
  if (length === 2) {
    return ((bytes[offset] & 0x1f) << 6)
      | (bytes[offset + 1] & 0x3f)
  }
  if (length === 3) {
    return ((bytes[offset] & 0x0f) << 12)
      | ((bytes[offset + 1] & 0x3f) << 6)
      | (bytes[offset + 2] & 0x3f)
  }
  return ((bytes[offset] & 0x07) << 18)
    | ((bytes[offset + 1] & 0x3f) << 12)
    | ((bytes[offset + 2] & 0x3f) << 6)
    | (bytes[offset + 3] & 0x3f)
}
