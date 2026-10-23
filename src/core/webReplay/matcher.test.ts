import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { WebRecordingMatcher, normalizeUrl } from './matcher'
import type { WebRecordingCall } from './schema'

const digest = (base64: string): string => createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')
const http = (id: number, url: string, body?: string, method = 'POST'): WebRecordingCall => ({ kind: 'http', id, t: id * 10, via: 'seam', method, url, headers: [], ...(body === undefined ? {} : { body: { text: body } }), chunks: [] })
const host = (id: number, command: string, args: unknown): WebRecordingCall => ({ kind: 'host', id, t: id * 10, command, args })

describe('WebRecordingMatcher', () => {
  it('pairs concurrent requests by their own fingerprint even when issued in another order', () => {
    const matcher = new WebRecordingMatcher([http(1, 'https://a.test/search', '{"q":"a"}'), http(2, 'https://a.test/search', '{"q":"b"}')], digest)
    expect(matcher.http({ method: 'POST', url: 'https://a.test/search', body: { text: '{"q":"b"}' } })?.call.id).toBe(2)
    expect(matcher.http({ method: 'POST', url: 'https://a.test/search', body: { text: '{"q":"a"}' } })?.call.id).toBe(1)
    expect(matcher.unused()).toEqual([])
  })

  it('falls back to the next unused call with the same method and URL when only the body changed', () => {
    const matcher = new WebRecordingMatcher([http(1, 'https://a.test/chat', '{"at":1}'), http(2, 'https://a.test/chat', '{"at":2}')], digest)
    const first = matcher.http({ method: 'post', url: 'https://a.test/chat', body: { text: '{"at":99}' } })
    expect(first).toMatchObject({ quality: 'loose', call: { id: 1 } })
    expect(matcher.http({ method: 'POST', url: 'https://a.test/chat', body: { text: '{"at":2}' } })).toMatchObject({ quality: 'exact', call: { id: 2 } })
    expect(matcher.http({ method: 'POST', url: 'https://a.test/chat', body: { text: '{"at":2}' } })).toBeNull()
  })

  it('refuses a request the recording never made', () => {
    const matcher = new WebRecordingMatcher([http(1, 'https://a.test/chat', '{}')], digest)
    expect(matcher.http({ method: 'POST', url: 'https://a.test/deeper', body: { text: '{}' } })).toBeNull()
    expect(matcher.unused().map(c => c.id)).toEqual([1])
  })

  it('compares binary bodies by digest and ignores query order and hash', () => {
    const bytes = Buffer.from([0xff, 1, 2])
    const matcher = new WebRecordingMatcher([{ ...http(1, 'https://a.test/u?b=2&a=1#x'), body: { blob: digest(bytes.toString('base64')), size: 3 } } as WebRecordingCall], digest)
    expect(normalizeUrl('https://a.test/u?b=2&a=1#x')).toBe('https://a.test/u?a=1&b=2')
    expect(matcher.http({ method: 'POST', url: 'https://a.test/u?a=1&b=2', body: { base64: bytes.toString('base64') } })?.quality).toBe('exact')
  })

  it('matches host commands by canonical arguments, then by command order', () => {
    const matcher = new WebRecordingMatcher([host(1, 'save_markdown', { name: 'a', content: 'x' }), host(2, 'plugin:event|listen', { event: 'tauri://close-requested', handler: 3 })], digest)
    expect(matcher.host('save_markdown', { content: 'x', name: 'a' })).toMatchObject({ quality: 'exact', call: { id: 1 } })
    expect(matcher.host('plugin:event|listen', { event: 'tauri://close-requested', handler: 7 })).toMatchObject({ quality: 'loose', call: { id: 2 } })
    expect(matcher.host('save_markdown', {})).toBeNull()
  })
})
