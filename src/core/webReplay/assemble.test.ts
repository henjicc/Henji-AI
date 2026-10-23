import { describe, expect, it } from 'vitest'
import type { ProbeEvent } from '../../../packages/web-replay-probe/src/protocol'
import { WebRecordingAssembler } from './assemble'
import { probeEventSchema, webRecordingBehaviorSchema, webRecordingDataSchema, type ProbeEventValue, type StoredBody } from './schema'

// Compile-time: every probe wire event is accepted by Henji's schema type.
const sameShape = (event: ProbeEvent): ProbeEventValue => event
void sameShape

const store = (body: { text: string } | { base64: string }): StoredBody => ('text' in body ? body : { blob: 'a'.repeat(64), size: 3 })
const events: ProbeEvent[] = [
  { seq: 0, kind: 'http.request', id: 1, t: 1000, via: 'seam', method: 'POST', url: 'https://api.test/chat', headers: [['authorization', 'Bearer sk-live']], body: { text: '{"q":"PHP 是啥"}' } },
  { seq: 1, kind: 'pointer', t: 1500, type: 'down', x: 10, y: 20, button: 0, buttons: 1, clickCount: 1, pointerType: 'mouse', mods: 0, target: { locator: { tag: 'button', path: 'div:nth-child(1)', act: { name: 'detail', anchor: 'n1' } }, rect: { x: 0, y: 0, width: 40, height: 20 }, offset: [0.25, 1] } },
  { seq: 2, kind: 'http.response', id: 1, t: 3000, status: 200, statusText: 'OK', url: 'https://api.test/chat', headers: [['content-type', 'text/event-stream']] },
  { seq: 3, kind: 'http.chunk', id: 1, t: 3500, body: { text: 'data: {"a":1}\n\n' } },
  { seq: 4, kind: 'http.chunk', id: 1, t: 4200, body: { base64: '/wAB' } },
  { seq: 5, kind: 'http.end', id: 1, t: 5000 },
  { seq: 6, kind: 'host.call', id: 1, t: 6000, command: 'save_markdown', args: { name: 'a.md' } },
  { seq: 7, kind: 'host.result', id: 1, t: 6400, ok: true, value: true },
  { seq: 8, kind: 'host.callback', t: 7000, call: 1, index: 0, payload: { event: 'tauri://close-requested' } },
  { seq: 9, kind: 'external', t: 7100, url: 'https://img.test/f.ico', initiator: 'img' },
  { seq: 10, kind: 'external', t: 7200, url: 'https://img.test/f.ico', initiator: 'img', outcome: 'error' },
  { seq: 11, kind: 'random', t: 7300, source: 'uuid', values: ['u1'] },
  { seq: 12, kind: 'boundary', t: 7400, boundary: 'xhr', detail: 'GET /x' },
  { seq: 13, kind: 'paste', t: 7500, text: 'hello', files: [{ name: 'a.png', type: 'image/png', lastModified: 1, body: { base64: '/wAB' } }] },
]

describe('WebRecordingAssembler', () => {
  it('folds the stream into validated tracks with offsets relative to each call', () => {
    for (const event of events) expect(probeEventSchema.safeParse(event).success, event.kind).toBe(true)
    const assembler = new WebRecordingAssembler(store)
    events.forEach(e => assembler.add(probeEventSchema.parse(e)))
    assembler.add(probeEventSchema.parse(events[3])) // resent after a reconnect: ignored
    const data = webRecordingDataSchema.parse(assembler.data())
    const call = data.calls.find(c => c.kind === 'http')!
    expect(call).toMatchObject({ headers: [['authorization', 'Bearer sk-live']], response: { at: 2000, status: 200 }, endAt: 4000 })
    expect(call.kind === 'http' && call.chunks.map(c => c.at)).toEqual([2500, 3200])
    expect(call.kind === 'http' && call.chunks[1].body).toEqual({ blob: 'a'.repeat(64), size: 3 })
    expect(data.calls.find(c => c.kind === 'host')).toMatchObject({ result: { at: 400, ok: true, value: true } })
    expect(data.callbacks).toEqual([{ t: 7000, call: 1, index: 0, payload: { event: 'tauri://close-requested' } }])
    expect(data.external).toEqual([{ url: 'https://img.test/f.ico', t: 7100, initiator: 'img', outcome: 'error' }])
    expect(data.random.uuid).toEqual(['u1'])
    expect(assembler.warnings).toEqual([{ t: 7400, kind: 'boundary', message: 'xhr: GET /x' }])
    const behavior = webRecordingBehaviorSchema.parse({ events: assembler.behaviorEvents() }).events
    expect(behavior.map(e => e.kind)).toEqual(['pointer', 'paste'])
    expect(behavior[1]).toMatchObject({ files: [{ name: 'a.png', body: { blob: 'a'.repeat(64) } }] })
    expect(assembler.durationUs).toBe(7500)
    expect(assembler.externalUrls()).toEqual(['https://img.test/f.ico'])
  })
})
