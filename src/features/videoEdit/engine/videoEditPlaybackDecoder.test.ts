import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { InputVideoTrack } from 'mediabunny'

// 10 pictures per second, key frame every 5 pictures (0.5 s GOP). With B-frames the decode order is
// I0 P2 B1 P4 B3 | I5 P7 B6 P9 B8 …: sequence numbers follow decode order, timestamps presentation order.
const media = vi.hoisted(() => ({ bFrames: false, rate: 10, gop: 5 }))
type Packet = { sequenceNumber: number; timestamp: number; duration: number; type: string; data: Uint8Array }
function packets(): Packet[] {
  const order = Array.from({ length: 40 }, (_, index) => index)
  if (media.bFrames) for (let gop = 0; gop < 40; gop += 5) order.splice(gop, 5, gop, gop + 2, gop + 1, gop + 4, gop + 3)
  return order.map((picture, sequenceNumber) => ({ sequenceNumber, timestamp: picture / media.rate, duration: 1 / media.rate, type: picture % media.gop ? 'delta' : 'key', data: new Uint8Array([picture]) }))
}
const decoder = vi.hoisted(() => ({ instances: [] as FakeDecoder[], dropPriorAtKey: false, asyncOutput: false, latency: 0 }))
type FakeChunk = { timestamp: number; type: string }
type FakeFrame = { timestamp: number; close: () => void; clone: () => FakeFrame }
const fakeFrame = (timestamp: number): FakeFrame => ({ timestamp, close: vi.fn(), clone: () => fakeFrame(timestamp) })
class FakeDecoder extends EventTarget {
  state = 'unconfigured'; decodeQueueSize = 0; flushes = 0; configs: unknown[] = []; decoded: number[] = []
  private held: FakeChunk[] = []; private done = new Set<number>()
  constructor(private readonly init: { output: (frame: FakeFrame) => void; error: (error: unknown) => void }) { super(); decoder.instances.push(this) }
  configure(config: unknown): void { this.state = 'configured'; this.configs.push(config) }
  decode(chunk: FakeChunk): void {
    this.decoded.push(chunk.timestamp)
    // A key frame outputs (or, when configured, discards) earlier pictures, like an H.264 IDR.
    if (chunk.type === 'key') { const prior = this.held.splice(0); this.done.clear(); if (!decoder.dropPriorAtKey) this.emit(prior) }
    this.held.push(chunk); this.held.sort((a, b) => a.timestamp - b.timestamp); this.done.add(chunk.timestamp)
    // Like H.264: a picture is output as soon as every earlier picture of its GOP has been decoded
    // (optionally only once more than `latency` pictures are held, like a decoder without reorder hints).
    while (this.held.length > decoder.latency) {
      const picture = Math.round(this.held[0].timestamp * media.rate / 1e6); const gop = Math.floor(picture / media.gop) * media.gop
      let ready = true; for (let index = gop; index < picture; index++) if (!this.done.has(microseconds(index / media.rate))) ready = false
      if (!ready) break
      this.emit(this.held.splice(0, 1))
    }
    queueMicrotask(() => this.dispatchEvent(new Event('dequeue')))
  }
  // Like WebCodecs, flush resolves only after every pending output has been delivered.
  async flush(): Promise<void> { this.flushes++; this.emit(this.held.splice(0)); await new Promise(resolve => setTimeout(resolve, 5)) }
  close(): void { this.state = 'closed' }
  private emit(chunks: FakeChunk[]): void { for (const chunk of chunks) { const frame = fakeFrame(chunk.timestamp); if (decoder.asyncOutput) setTimeout(() => this.init.output(frame), 0); else this.init.output(frame) } }
}
vi.mock('mediabunny', () => ({
  EncodedPacket: class { constructor(readonly data: Uint8Array, readonly type: string, readonly timestamp: number, readonly duration: number) {} },
  EncodedPacketSink: class {
    async getPacket(time: number) { return withChunk([...packets()].sort((a, b) => b.timestamp - a.timestamp).find(packet => packet.timestamp <= time + 1e-9) ?? null) }
    async getKeyPacket(time: number) { return withChunk([...packets()].sort((a, b) => b.timestamp - a.timestamp).find(packet => packet.type === 'key' && packet.timestamp <= time + 1e-9) ?? null) }
    async getNextPacket(packet: { sequenceNumber: number }) { return withChunk(packets()[packet.sequenceNumber + 1] ?? null) }
  },
  VideoSample: class {
    timestamp = 0; closed = false
    constructor(readonly frame: { timestamp: number; close: () => void }) { this.timestamp = frame.timestamp / 1e6 }
    setTimestamp(value: number) { this.timestamp = value } setRotation() {} setFlip() {}
    clone() { const copy = new (this.constructor as new (frame: unknown) => { timestamp: number })(this.frame); copy.timestamp = this.timestamp; return copy }
    close() { this.closed = true }
  },
}))
// mediabunny truncates (not rounds) packet times to microseconds; at 60fps two of three differ from rounding.
const microseconds = (seconds: number): number => Math.trunc(1e6 * (1 + Number.EPSILON) * seconds)
function withChunk<T extends { timestamp: number; type: string } | null>(packet: T) {
  return packet && { ...packet, microsecondTimestamp: microseconds(packet.timestamp), toEncodedVideoChunk: () => ({ timestamp: microseconds(packet.timestamp), type: packet.type }) }
}
const track = { getDecoderConfig: async () => ({ codec: 'avc1.640033' }), getRotation: async () => 0, getFlip: async () => false, getCodedWidth: async () => 3840, getCodedHeight: async () => 2160 } as unknown as InputVideoTrack
const { scheduledVideoSamples, avcDpbLevel, withAvcLevel, withInBandAvcLevel } = await import('./videoEditPlaybackDecoder')
async function collect(times: number[]): Promise<Array<number | null>> {
  const out: Array<number | null> = []
  for await (const sample of scheduledVideoSamples(track, { hardwareAcceleration: 'prefer-hardware' }, times)) { out.push(sample ? sample.timestamp : null); sample?.close() }
  return out
}
beforeEach(() => { decoder.instances = []; decoder.dropPriorAtKey = false; decoder.asyncOutput = false; decoder.latency = 0; media.bFrames = false; media.rate = 10; media.gop = 5; vi.stubGlobal('VideoDecoder', FakeDecoder) })
afterEach(() => { vi.unstubAllGlobals() })

it('正向播放跨GOP持续送包，播放中不flush，逐帧画面正确', async () => {
  const times = Array.from({ length: 20 }, (_, index) => .3 + index / 10)
  expect(await collect(times)).toEqual(times.map(time => Math.round(time * 10) / 10))
  const [instance] = decoder.instances
  expect(instance.flushes).toBe(1) // only the end of the schedule drains
  expect(instance.decoded).toEqual(Array.from({ length: 23 }, (_, index) => index * 100000)) // from the first key, each packet once
  expect(instance.state).toBe('closed')
})

it('同文件剪辑点回跳从目标关键帧重新起跑，不flush也不重建解码器', async () => {
  const times = [1.1, 1.2, 1.3, 0.2, 0.3, 2.6]
  expect(await collect(times)).toEqual([1.1, 1.2, 1.3, 0.2, 0.3, 2.6])
  expect(decoder.instances).toHaveLength(1); expect(decoder.instances[0].flushes).toBe(1)
  // Back to the 0.0 key for the cut, then a forward skip starts at the 2.5 key instead of decoding 0.4–2.4.
  expect(decoder.instances[0].decoded.map(us => us / 1e5)).toEqual([10, 11, 12, 13, 0, 1, 2, 3, 25, 26])
})

it('解码器在新关键帧丢弃先前画面时，任何槽位只会得到准确画面或null（交给常规定位路径），其后恢复', async () => {
  decoder.dropPriorAtKey = true
  const expected = [1.1, 1.2, 1.3, 0.2, 0.3]
  const out = await collect(expected)
  // Never a wrong picture: each slot is the exact one or null (regular seek path).
  out.forEach((value, index) => expect([null, expected[index]]).toContain(value))
  expect(out.slice(3)).toEqual([0.2, 0.3])
})

it('提前停止时关闭解码器并释放已解码未交付的画面', async () => {
  const generator = scheduledVideoSamples(track, {}, Array.from({ length: 30 }, (_, index) => index / 10))
  const first = await generator.next(); expect((first.value as { timestamp: number }).timestamp).toBe(0)
  await generator.return(undefined)
  expect(decoder.instances[0].state).toBe('closed')
})

it('B帧文件按呈现时间判断正向，逐帧送包一次，不因解码顺序回退而重跑GOP', async () => {
  media.bFrames = true
  const times = Array.from({ length: 20 }, (_, index) => .3 + index / 10)
  expect(await collect(times)).toEqual(times.map(time => Math.round(time * 10) / 10))
  const [instance] = decoder.instances
  expect(instance.flushes).toBe(1)
  // Each packet from the first key up to the last needed picture is decoded exactly once.
  const decoded = instance.decoded.map(us => us / 1e5)
  expect(new Set(decoded).size).toBe(decoded.length); expect(decoded.length).toBeLessThanOrEqual(25)
})

it('同一画面被连续请求（低帧率素材放在高帧率序列）时每次都得到该画面，不回退', async () => {
  media.bFrames = true
  const times = [0.3, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55]
  expect(await collect(times)).toEqual([0.3, 0.3, 0.3, 0.4, 0.4, 0.5, 0.5])
})

it('解码器异步、提前输出后续画面时，消费者慢速逐帧取用也不会停滞', async () => {
  media.bFrames = true; decoder.asyncOutput = true
  const times = Array.from({ length: 30 }, (_, index) => index / 10)
  const out: Array<number | null> = []
  for await (const sample of scheduledVideoSamples(track, {}, times)) { out.push(sample ? sample.timestamp : null); sample?.close(); await new Promise(resolve => setTimeout(resolve, 1)) }
  expect(out).toEqual(times.map(time => Math.round(time * 10) / 10))
})

it('60fps素材的微秒时间与解码输出逐帧对上（mediabunny截断而非四舍五入），全部命中不回退', async () => {
  media.bFrames = true; media.rate = 60
  const times = Array.from({ length: 30 }, (_, index) => (index + 3) / 60)
  const out = await collect(times)
  expect(out.every(value => value !== null)).toBe(true)
  expect(out.map(value => Math.round(value! * 60))).toEqual(times.map(time => Math.round(time * 60)))
})

// avcC with one SPS: [1, profile 100, compat 0, level, 0xff, 0xe1, len, SPS(nal 0x67, profile, constraint, level, …), 1 PPS]
const avcc = (level: number) => new Uint8Array([1, 100, 0, level, 0xff, 0xe1, 0, 6, 0x67, 100, 0, level, 0xac, 0xd9, 1, 0, 2, 0x68, 0xeb])
it('按编码尺寸把H.264级别提到允许16帧参考缓冲的最低级别；已足够或无法满足时不改', () => {
  expect(avcDpbLevel({ codec: 'avc1.640034', description: avcc(52) }, 3840, 2160)).toBe(60)
  expect(avcDpbLevel({ codec: 'avc1.640028', description: avcc(40) }, 1920, 1088)).toBe(51)
  expect(avcDpbLevel({ codec: 'avc1.64003e', description: avcc(62) }, 3840, 2160)).toBeUndefined()
  expect(avcDpbLevel({ codec: 'avc1.640034', description: avcc(52) }, 7680, 4320)).toBeUndefined()
  expect(avcDpbLevel({ codec: 'avc1.640034' }, 3840, 2160)).toBeUndefined()
  expect(avcDpbLevel({ codec: 'hvc1.1.6.L153', description: avcc(52) }, 3840, 2160)).toBeUndefined()
  const raised = withAvcLevel(avcc(52), 60)
  expect([raised[3], raised[11]]).toEqual([60, 60]); expect(avcc(52)[3]).toBe(52)
  expect(Array.from(raised).filter((_, index) => index !== 3 && index !== 11)).toEqual(Array.from(avcc(52)).filter((_, index) => index !== 3 && index !== 11))
})

it('码流内重复的SPS与描述使用相同级别，避免解码器在播放中重建；其他NAL与原包不变', async () => {
  const { EncodedPacket } = await import('mediabunny')
  const inBand = new Uint8Array([0, 0, 0, 4, 0x67, 100, 0, 52, 0, 0, 0, 2, 0x65, 0x88])
  const packet = new EncodedPacket(inBand, 'key', 0, .1)
  const rewritten = withInBandAvcLevel(packet, { codec: 'avc1.640034', description: avcc(52) }, 60)
  expect(Array.from(rewritten.data)).toEqual([0, 0, 0, 4, 0x67, 100, 0, 60, 0, 0, 0, 2, 0x65, 0x88])
  expect(Array.from(inBand)).toEqual([0, 0, 0, 4, 0x67, 100, 0, 52, 0, 0, 0, 2, 0x65, 0x88])
  const slice = new EncodedPacket(new Uint8Array([0, 0, 0, 2, 0x41, 0x9a]), 'delta', .1, .1)
  expect(withInBandAvcLevel(slice, { codec: 'avc1.640034', description: avcc(52) }, 60)).toBe(slice)
  // The decoder is configured with the raised description.
  const levelTrack = { ...track, getDecoderConfig: async () => ({ codec: 'avc1.640034', description: avcc(52) }) } as unknown as InputVideoTrack
  for await (const sample of scheduledVideoSamples(levelTrack, {}, [0])) sample?.close()
  const config = decoder.instances[0].configs[0] as { description: Uint8Array }
  expect([config.description[3], config.description[11]]).toEqual([60, 60])
})

it('解码器持有的画面多于在途上限时，消费者等待会放开送包，不会死锁', async () => {
  decoder.latency = 12; media.gop = 40
  const times = Array.from({ length: 30 }, (_, index) => index / 10)
  expect(await collect(times)).toEqual(times.map(time => Math.round(time * 10) / 10))
})

