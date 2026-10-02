import { EncodedPacket, EncodedPacketSink, VideoSample, type InputVideoTrack } from 'mediabunny'

/** Decoded pictures waiting for the consumer (~100ms at 60fps), so decoding runs ahead of presentation. */
const READY_LIMIT = 6
/**
 * Pictures fed but not yet released by us (inside the decoder, ready or spare). Every one holds a decoder
 * picture buffer, as do pictures we released that are still queued on the GPU; when the pool runs dry the
 * decoder blocks the GPU main thread. Together with the raised level (a 21-picture pool) this leaves room for
 * the GPU queue.
 */
const IN_FLIGHT_LIMIT = 10
const QUEUE_LIMIT = 16
const PACKET_OPTIONS = { verifyKeyPackets: true }

interface Slot { promise: Promise<VideoSample | null>; resolve: (sample: VideoSample | null) => void; filled: boolean; ready: boolean }
/**
 * A run is a forward stretch decoded from one key frame; a cut starts a new run without flushing.
 * With B-frames a decoder outputs a picture as soon as its presentation turn comes, which can be before the
 * request for it is registered (the next P-frame is fed to decode an earlier B-frame). Such pictures, and the
 * latest delivered one (repeated requests for the same picture), wait in `spare` until a later request
 * supersedes them.
 */
interface Run { pending: Set<number>; wanted: Array<{ us: number; slot: Slot }>; spare: Map<number, VideoFrame>; lastWanted: number }

function slot(onReady: () => void): Slot {
  let resolve!: (sample: VideoSample | null) => void
  const promise = new Promise<VideoSample | null>(done => { resolve = done })
  const value: Slot = { promise, filled: false, ready: false, resolve: sample => {
    if (value.filled) { sample?.close(); return }
    value.filled = true; if (sample) { value.ready = true; onReady() }
    resolve(sample)
  } }
  return value
}

/**
 * Same contract as mediabunny `samplesAtTimestamps` (one sample or null per requested source time, in order;
 * the sample is the last picture starting at or before that time), for forward preview playback.
 *
 * mediabunny flushes its decoder whenever the key frame changes. In Chromium a WebCodecs flush re-initializes
 * the hardware decoder, and on Windows the first decode after that rebuilds the D3D11 decoder synchronously on
 * the GPU main thread — the thread WebGPU draws on — stalling the picture for ~80ms. This pump never flushes
 * while playing: it keeps feeding packets across GOPs and starts a new run at the target key frame on a cut.
 * Pictures are matched by the chunk timestamp Chromium preserves; anything unexpected yields null so the
 * caller falls back to its regular seek path for that frame.
 */
export async function* scheduledVideoSamples(track: InputVideoTrack, options: Pick<VideoDecoderConfig, 'hardwareAcceleration' | 'optimizeForLatency'>, timestamps: Iterable<number>, onError?: (error: unknown) => void): AsyncGenerator<VideoSample | null, void, unknown> {
  // Requested slots not yet handed to the consumer, in request order.
  const slots: Slot[] = []
  let finished = false; let terminated = false; let failed = false
  // Decoded pictures waiting in `slots`.
  let ready = 0
  let wakePump: (() => void) | undefined; let wakeConsumer: (() => void) | undefined
  // The consumer waits on a picture that needs more input: always feed then, whatever the cushions say.
  let starved = false
  const notify = (): void => { const pump = wakePump; const consumer = wakeConsumer; wakePump = undefined; wakeConsumer = undefined; pump?.(); consumer?.() }
  const onReady = (): void => { ready++ }
  const runs: Run[] = []; let outputRun = 0
  let spares = 0
  let fed = 0; let outputs = 0
  const releaseSpares = (run: Run, before = Infinity): void => {
    for (const [us, frame] of run.spare) if (us < before) { frame.close(); run.spare.delete(us); spares-- }
  }
  const deliver = (frame: VideoFrame, us: number, slot: Slot): void => {
    const sample = new VideoSample(frame.clone()); sample.setTimestamp(us / 1e6); sample.setRotation(rotation); sample.setFlip(flip)
    slot.resolve(sample)
  }
  const fail = (error: unknown): void => {
    if (failed) return
    failed = true; onError?.(error)
    for (const value of slots) value.resolve(null)
    notify()
  }
  const [original, rotation, flip, codedWidth, codedHeight] = await Promise.all([track.getDecoderConfig(), track.getRotation(), track.getFlip(), track.getCodedWidth(), track.getCodedHeight()])
  if (!original) throw new Error('视频轨没有解码配置。')
  const level = avcDpbLevel(original, codedWidth, codedHeight)
  const config = level ? { ...original, description: withAvcLevel(original.description!, level) } : original
  const decoder = new VideoDecoder({
    output: frame => {
      outputs++
      notify()
      const us = frame.timestamp
      // Pictures of an abandoned run (a decoder may drop pictures preceding a new key frame) are skipped.
      let index = outputRun
      while (index < runs.length && !runs[index].pending.has(us)) index++
      if (index === runs.length || terminated || failed) { frame.close(); return }
      for (; outputRun < index; outputRun++) { for (const wanted of runs[outputRun].wanted) wanted.slot.resolve(null); runs[outputRun].wanted.length = 0; releaseSpares(runs[outputRun]) }
      const run = runs[index]; run.pending.delete(us)
      // Earlier requests whose exact picture never came (dropped by the decoder) fall back to the seek path.
      while (run.wanted.length && run.wanted[0].us < us) run.wanted.shift()!.slot.resolve(null)
      if (!run.wanted.length && us < run.lastWanted) { frame.close(); return }
      while (run.wanted.length && run.wanted[0].us === us) deliver(frame, us, run.wanted.shift()!.slot)
      // Only a newer request supersedes a picture; the latest requested one may be asked for again.
      releaseSpares(run, run.lastWanted)
      run.spare.set(us, frame); spares++
      notify()
    },
    error: fail,
  })
  // The pump waits on the decode queue as well as on the consumer.
  decoder.addEventListener('dequeue', notify)
  decoder.configure({ ...config, ...options, colorSpace: completeColorSpace(config.colorSpace) })

  const pump = (async () => {
    const sink = new EncodedPacketSink(track)
    let run: Run | undefined; let lastTarget: EncodedPacket | undefined; let lastFed: EncodedPacket | undefined
    const feed = async (packet: EncodedPacket): Promise<void> => {
      while (!terminated && !failed && (decoder.decodeQueueSize >= QUEUE_LIMIT || !starved && (ready >= READY_LIMIT || fed - outputs + ready + spares >= IN_FLIGHT_LIMIT))) await new Promise<void>(resume => { wakePump = resume })
      if (terminated || failed) return
      const first = !lastFed
      run!.pending.add(packet.microsecondTimestamp); fed++
      const chunk = level ? withInBandAvcLevel(packet, config, level) : packet
      decoder.decode((first ? chromiumFirstAvcPacket(chunk, config) : chunk).toEncodedVideoChunk())
      lastFed = packet
    }
    for (const time of timestamps) {
      if (terminated || failed) break
      const value = slot(onReady); slots.push(value); notify()
      const target = await sink.getPacket(time, PACKET_OPTIONS)
      const key = target && await sink.getKeyPacket(time, PACKET_OPTIONS)
      if (!target || !key) { value.resolve(null); continue }
      // Forward is judged in presentation time: with B-frames, decode order (sequence numbers) is not monotonic.
      const continues = run && lastTarget && lastFed && target.timestamp >= lastTarget.timestamp && key.sequenceNumber <= lastFed.sequenceNumber + 1
      if (!continues) {
        run = { pending: new Set(), wanted: [], spare: new Map(), lastWanted: -Infinity }; runs.push(run)
        await feed(key)
      }
      const us = target.microsecondTimestamp
      releaseSpares(run!, us); run!.lastWanted = us
      const early = run!.spare.get(us)
      if (early) deliver(early, us, value)
      else run!.wanted.push({ us, slot: value })
      while (!terminated && !failed && lastFed && lastFed.sequenceNumber < target.sequenceNumber) {
        const next = await sink.getNextPacket(lastFed, PACKET_OPTIONS)
        if (!next) break
        await feed(next)
      }
      lastTarget = target
    }
    // Only the end of the schedule drains the decoder.
    if (!terminated && !failed) await decoder.flush()
    for (const value of slots) value.resolve(null)
    for (const run of runs) releaseSpares(run)
  })().catch(fail).finally(() => { finished = true; notify() })

  try {
    while (slots.length || !finished) {
      if (!slots.length) { await new Promise<void>(resume => { wakeConsumer = resume }); continue }
      if (!slots[0].filled) { starved = true; notify() }
      const sample = await slots[0].promise
      starved = false
      if (slots.shift()!.ready) ready--
      notify()
      yield sample
    }
  } finally {
    terminated = true; notify()
    for (const value of slots) { value.resolve(null); void value.promise.then(sample => sample?.close()) }
    await pump.catch(() => undefined)
    for (const run of runs) releaseSpares(run)
    if (decoder.state !== 'closed') decoder.close()
  }
}

/** Chromium drops incomplete color spaces instead of defaulting them (mediabunny applies the same fix). */
function completeColorSpace(colorSpace: VideoColorSpaceInit | undefined): VideoColorSpaceInit {
  return { primaries: colorSpace?.primaries ?? 'bt709', matrix: colorSpace?.matrix ?? 'bt709', transfer: colorSpace?.transfer ?? 'bt709', fullRange: colorSpace?.fullRange ?? false }
}

/**
 * Chromium's key-frame check on the first chunk after configure trips over access unit delimiters and
 * reserved NAL units in length-prefixed AVC (mediabunny issue #396); strip them from that chunk only.
 */
function chromiumFirstAvcPacket(packet: EncodedPacket, config: VideoDecoderConfig): EncodedPacket {
  if (!config.codec.startsWith('avc1') && !config.codec.startsWith('avc3')) return packet
  const description = config.description
  if (!description) return packet
  const record = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description)
  const lengthSize = (record[4] & 3) + 1
  const data = packet.data; const kept: Uint8Array[] = []; let hasFrame = false
  for (let offset = 0; offset + lengthSize <= data.length;) {
    let length = 0; for (let index = 0; index < lengthSize; index++) length = length * 256 + data[offset + index]
    const start = offset + lengthSize; const end = start + length
    if (length < 1 || end > data.length) return packet
    const type = data[start] & 0x1f
    hasFrame ||= type >= 1 && type <= 5
    if (type === 9) { if (hasFrame) break; kept.length = 0 } else if (!(type >= 20 && type <= 31)) kept.push(data.subarray(offset, end))
    offset = end
  }
  const size = kept.reduce((sum, unit) => sum + unit.length, 0)
  if (size === data.length) return packet
  const merged = new Uint8Array(size); let at = 0
  for (const unit of kept) { merged.set(unit, at); at += unit.length }
  return new EncodedPacket(merged, packet.type, packet.timestamp, packet.duration)
}

/**
 * Chromium sizes a hardware decoder's picture pool as DPB size + 5, the DPB size coming from the SPS level at
 * the coded size (5 pictures for 4K at level 5.x). A long-lived decoder must also cover pictures still queued on
 * the GPU, otherwise decoding blocks the GPU main thread waiting for a free picture. Raising level_idc to the
 * lowest level allowing a 16-picture DPB keeps the bitstream conformant (a stream meeting a level meets every
 * higher one) and enlarges the pool. Returns undefined when the stream already allows 16 or no level can.
 */
export function avcDpbLevel(config: VideoDecoderConfig, codedWidth: number, codedHeight: number): number | undefined {
  if (!config.codec.startsWith('avc1') || !config.description) return undefined
  const record = bytes(config.description)
  const current = record[3]
  const frameMbs = Math.ceil(codedWidth / 16) * Math.ceil(codedHeight / 16)
  const dpb = (value: number): number => Math.min(16, Math.floor((MAX_DPB_MBS.get(value) ?? 0) / frameMbs))
  if (!frameMbs || !MAX_DPB_MBS.has(current) || dpb(current) >= 16) return undefined
  return [...MAX_DPB_MBS.keys()].find(value => value > current && dpb(value) >= 16)
}
/** H.264 Table A-1 MaxDpbMbs by level_idc. */
const MAX_DPB_MBS = new Map([[10, 396], [11, 900], [12, 2376], [13, 2376], [20, 2376], [21, 4752], [22, 8100], [30, 8100], [31, 18000], [32, 20480], [40, 32768], [41, 32768], [42, 34816], [50, 110400], [51, 184320], [52, 184320], [60, 696320], [61, 696320], [62, 696320]])
function bytes(source: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source)
}
/** avcC: AVCLevelIndication (byte 3) and level_idc of every SPS (byte 3 of each SPS NAL unit). */
export function withAvcLevel(description: AllowSharedBufferSource, level: number): Uint8Array {
  const record = bytes(description).slice()
  record[3] = level
  let offset = 6
  for (let count = record[5] & 0x1f; count > 0 && offset + 2 <= record.length; count--) {
    const length = (record[offset] << 8) | record[offset + 1]
    if (length >= 4 && offset + 2 + length <= record.length) record[offset + 2 + 3] = level
    offset += 2 + length
  }
  return record
}
/** In-band SPS units must carry the same level, or Chromium sees a DPB change and re-initializes. */
export function withInBandAvcLevel(packet: EncodedPacket, config: VideoDecoderConfig, level: number): EncodedPacket {
  const lengthSize = (bytes(config.description!)[4] & 3) + 1
  const data = packet.data; let copy: Uint8Array | undefined
  for (let offset = 0; offset + lengthSize <= data.length;) {
    let length = 0; for (let index = 0; index < lengthSize; index++) length = length * 256 + data[offset + index]
    const start = offset + lengthSize
    if (length < 1 || start + length > data.length) break
    if ((data[start] & 0x1f) === 7 && length >= 4 && data[start + 3] !== level) { copy ??= data.slice(); copy[start + 3] = level }
    offset = start + length
  }
  return copy ? new EncodedPacket(copy, packet.type, packet.timestamp, packet.duration) : packet
}

