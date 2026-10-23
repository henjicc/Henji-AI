import { base64ToBytes, bytesToBase64 } from './body'

/**
 * JSON encoding for structured-clone values (IndexedDB records, host call arguments and results).
 * Plain JSON values pass through; everything else becomes `{ $t: tag, ... }`. Objects that already
 * own a `$t` key are wrapped so decoding is unambiguous.
 */
type Tagged = { $t: string; v?: unknown; type?: string; ctor?: string; name?: string; lastModified?: number }

const TYPED: Record<string, new (buffer: ArrayBuffer) => ArrayBufferView> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView,
}

/** Blobs need an async read, so encoding is async; decoding is synchronous. */
export async function encodeValue(value: unknown, seen = new WeakSet<object>()): Promise<unknown> {
  if (value === undefined) return { $t: 'undef' }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $t: 'nan' }
    if (!Number.isFinite(value)) return { $t: value > 0 ? 'inf' : '-inf' }
    if (Object.is(value, -0)) return { $t: '-0' }
    return value
  }
  if (typeof value === 'bigint') return { $t: 'bigint', v: value.toString() }
  if (typeof value !== 'object') return { $t: 'undef' } // functions/symbols are not cloneable
  if (seen.has(value)) throw new Error('痕迹录制不支持循环引用的数据')
  seen.add(value)
  try {
    if (value instanceof Date) return { $t: 'date', v: value.getTime() }
    if (value instanceof RegExp) return { $t: 'regexp', v: [value.source, value.flags] }
    if (value instanceof ArrayBuffer) return { $t: 'buffer', v: bytesToBase64(new Uint8Array(value)) }
    if (ArrayBuffer.isView(value)) return { $t: 'view', ctor: value.constructor.name, v: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) }
    if (typeof File !== 'undefined' && value instanceof File) return { $t: 'file', name: value.name, type: value.type, lastModified: value.lastModified, v: bytesToBase64(new Uint8Array(await value.arrayBuffer())) }
    if (typeof Blob !== 'undefined' && value instanceof Blob) return { $t: 'blob', type: value.type, v: bytesToBase64(new Uint8Array(await value.arrayBuffer())) }
    if (value instanceof Map) return { $t: 'map', v: await Promise.all([...value].map(async ([k, v]) => [await encodeValue(k, seen), await encodeValue(v, seen)])) }
    if (value instanceof Set) return { $t: 'set', v: await Promise.all([...value].map(v => encodeValue(v, seen))) }
    if (Array.isArray(value)) return Promise.all(value.map(v => encodeValue(v, seen)))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = await encodeValue(v, seen)
    return '$t' in out ? { $t: 'obj', v: out } : out
  } finally { seen.delete(value) }
}

export function decodeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decodeValue)
  const tagged = value as Tagged
  if (typeof tagged.$t !== 'string') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeValue(v)]))
  switch (tagged.$t) {
    case 'undef': return undefined
    case 'nan': return NaN
    case 'inf': return Infinity
    case '-inf': return -Infinity
    case '-0': return -0
    case 'bigint': return BigInt(tagged.v as string)
    case 'date': return new Date(tagged.v as number)
    case 'regexp': { const [source, flags] = tagged.v as [string, string]; return new RegExp(source, flags) }
    case 'buffer': return base64ToBytes(tagged.v as string).buffer
    case 'view': {
      const bytes = base64ToBytes(tagged.v as string)
      const Ctor = TYPED[tagged.ctor ?? 'Uint8Array'] ?? Uint8Array
      return new Ctor(bytes.buffer)
    }
    case 'file': return new File([base64ToBytes(tagged.v as string)], tagged.name ?? 'file', { type: tagged.type, lastModified: tagged.lastModified })
    case 'blob': return new Blob([base64ToBytes(tagged.v as string)], { type: tagged.type })
    case 'map': return new Map((tagged.v as Array<[unknown, unknown]>).map(([k, v]) => [decodeValue(k), decodeValue(v)]))
    case 'set': return new Set((tagged.v as unknown[]).map(decodeValue))
    case 'obj': return Object.fromEntries(Object.entries(tagged.v as Record<string, unknown>).map(([k, v]) => [k, decodeValue(v)]))
    default: throw new Error(`未知的录制数据类型：${tagged.$t}`)
  }
}
