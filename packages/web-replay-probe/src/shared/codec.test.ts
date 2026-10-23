import { describe, expect, it } from 'vitest'
import { decodeValue, encodeValue } from './codec'
import { bytesToWire, wireToBytes } from './body'

describe('structured value codec', () => {
  it('round-trips values IndexedDB and Tauri commands carry', async () => {
    const value = {
      date: new Date(1700000000000), big: 12n, nan: NaN, inf: -Infinity, negZero: -0, undef: undefined,
      bytes: new Uint16Array([1, 65535]), buffer: new Uint8Array([7, 8]).buffer,
      map: new Map<unknown, unknown>([['a', 1], [2, { b: true }]]), set: new Set(['x']), re: /a+b/gi,
      nested: [{ $t: 'looks tagged', v: 1 }], blob: new Blob(['hi'], { type: 'text/plain' }),
    }
    const decoded = decodeValue(JSON.parse(JSON.stringify(await encodeValue(value)))) as typeof value
    expect(decoded.date.getTime()).toBe(1700000000000)
    expect(decoded.big).toBe(12n)
    expect(Number.isNaN(decoded.nan)).toBe(true)
    expect(decoded.inf).toBe(-Infinity)
    expect(Object.is(decoded.negZero, -0)).toBe(true)
    expect('undef' in decoded && decoded.undef === undefined).toBe(true)
    expect([...decoded.bytes]).toEqual([1, 65535])
    expect(decoded.bytes).toBeInstanceOf(Uint16Array)
    expect([...new Uint8Array(decoded.buffer)]).toEqual([7, 8])
    expect([...decoded.map]).toEqual([['a', 1], [2, { b: true }]])
    expect([...decoded.set]).toEqual(['x'])
    expect(decoded.re.source).toBe('a+b')
    expect(decoded.re.flags).toBe('gi')
    expect(decoded.nested).toEqual([{ $t: 'looks tagged', v: 1 }])
    expect(await decoded.blob.text()).toBe('hi')
  })

  it('rejects cycles instead of hanging', async () => {
    const a: Record<string, unknown> = {}
    a.self = a
    await expect(encodeValue(a)).rejects.toThrow('循环引用')
  })
})

describe('wire bodies', () => {
  it('keeps text as text and binary (including a BOM) exactly', () => {
    expect(bytesToWire(new TextEncoder().encode('数据'))).toEqual({ text: '数据' })
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61])
    expect([...wireToBytes(bytesToWire(bom))]).toEqual([...bom])
    const binary = new Uint8Array([0xff, 0x00, 0xc3])
    const wire = bytesToWire(binary)
    expect('base64' in wire).toBe(true)
    expect([...wireToBytes(wire)]).toEqual([...binary])
  })
})
