import { EncodedPacketSink, VideoSample, type InputVideoTrack } from 'mediabunny'

/** Prepared all-intra tracks need no GOP reset. Keep one configured decoder alive
 * across arbitrary forward/reverse seeks instead of recreating it per pointer event. */
export class VideoEditIntraDecoder {
  private readonly packets: EncodedPacketSink
  private readonly decoder: VideoDecoder
  private readonly pending = new Map<number, { resolve: (sample: VideoSample) => void; reject: (error: Error) => void; duration: number; timestamp: number }>()
  private readonly avcLengthSize?: number
  private busy = false
  private failed?: Error
  constructor(track: InputVideoTrack, config: VideoDecoderConfig) {
    this.packets = new EncodedPacketSink(track)
    const description = config.description
    const avcc = description ? ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description) : undefined
    if (config.codec.startsWith('avc') && avcc && avcc.length >= 5 && avcc[0] === 1) this.avcLengthSize = (avcc[4] & 3) + 1
    this.decoder = new VideoDecoder({
      output: frame => {
        const pending = this.pending.get(frame.timestamp); this.pending.delete(frame.timestamp)
        try { if (pending) pending.resolve(new VideoSample(frame, { duration: pending.duration, timestamp: pending.timestamp })); else frame.close() }
        catch (error) { frame.close(); pending?.reject(error instanceof Error ? error : new Error(String(error))) }
      },
      error: error => { this.failed = error; for (const pending of this.pending.values()) pending.reject(error); this.pending.clear() },
    })
    this.decoder.configure({ ...config, colorSpace: { primaries: config.colorSpace?.primaries ?? 'bt709', transfer: config.colorSpace?.transfer ?? 'bt709', matrix: config.colorSpace?.matrix ?? 'bt709', fullRange: config.colorSpace?.fullRange ?? false } })
  }
  async sample(time: number): Promise<VideoSample | undefined> {
    if (this.failed) throw this.failed
    if (this.busy) throw new Error('独立帧解码必须串行。')
    this.busy = true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const packet = await this.packets.getPacket(time + 1e-7)
      if (!packet) return undefined
      if (packet.type !== 'key') throw new Error('预览缓存必须包含独立可定位的完整帧。')
      const result = new Promise<VideoSample>((resolve, reject) => { this.pending.set(packet.microsecondTimestamp, { resolve, reject, duration: packet.duration, timestamp: packet.timestamp }) })
      const chunk = packet.toEncodedVideoChunk()
      if (this.avcLengthSize) {
        // A trailing access-unit delimiter completes the H.264 picture in Chromium
        // without a decoder flush or decoding a duplicate 4K picture.
        const data = new Uint8Array(chunk.byteLength + this.avcLengthSize + 2)
        chunk.copyTo(data.subarray(0, chunk.byteLength))
        data[chunk.byteLength + this.avcLengthSize - 1] = 2
        data.set([0x09, 0xf0], chunk.byteLength + this.avcLengthSize)
        this.decoder.decode(new EncodedVideoChunk({ type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration ?? undefined, data }))
      } else {
        this.decoder.decode(chunk)
        this.decoder.decode(chunk)
      }
      timer = setTimeout(() => { void this.decoder.flush().catch(error => { this.pending.get(packet.microsecondTimestamp)?.reject(error); this.pending.delete(packet.microsecondTimestamp) }) }, 16)
      return await result
    } finally { clearTimeout(timer); this.busy = false }
  }
  close(): void {
    for (const pending of this.pending.values()) pending.reject(new Error('预览解码已关闭。')); this.pending.clear()
    if (this.decoder.state !== 'closed') this.decoder.close()
  }
}
