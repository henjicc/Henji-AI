import { AiRuntimeError } from '../../../runtime/AiRuntimeError'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let sequence = 0

function uuidFromSeed(seed: string): string {
  let state = 0x811c9dc5
  const bytes = new Uint8Array(16)
  for (let index = 0; index < bytes.length; index += 1) {
    for (const character of seed) {
      state ^= character.charCodeAt(0) + index
      state = Math.imul(state, 0x01000193)
    }
    bytes[index] = state >>> ((index % 4) * 8)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function volcengineRequestId(
  requestId: string,
  factory: ((requestId: string) => string) | undefined
): string {
  const value = factory
    ? factory(requestId).trim()
    : uuidFromSeed(`${requestId}:${Date.now()}:${sequence++}`)
  if (!UUID_PATTERN.test(value)) {
    throw new AiRuntimeError('invalid_task_id', 'Volcengine ASR request id must be a UUID')
  }
  return value
}
