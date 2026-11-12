import fs from 'node:fs/promises'

/** 录制轨道写出的 PCM WAV 的布局。数据长度以文件里真实存在的完整采样帧为准。 */
export interface WavLayout {
  format: 'pcm' | 'float'
  channels: number
  sampleRate: number
  bitsPerSample: number
  blockAlign: number
  dataOffset: number
  dataBytes: number
  /** 头里记的数据长度与文件实际不符：写的人没来得及收尾（进程退出、断电）。 */
  unfinished: boolean
  dataSizeOffset: number
  rf64: boolean
}

export async function readWavLayout(file: string): Promise<WavLayout> {
  const handle = await fs.open(file, 'r')
  try {
    const { size } = await handle.stat()
    const head = Buffer.alloc(Math.min(size, 64 * 1024))
    await handle.read(head, 0, head.length, 0)
    const riff = head.toString('ascii', 0, 4)
    if (head.length < 12 || riff !== 'RIFF' && riff !== 'RF64' || head.toString('ascii', 8, 12) !== 'WAVE') throw new Error('录制声音文件不是 WAV')
    let offset = 12, fmt: Omit<WavLayout, 'dataOffset' | 'dataBytes' | 'unfinished' | 'dataSizeOffset' | 'rf64'> | undefined, ds64DataBytes: number | undefined
    while (offset + 8 <= head.length) {
      const id = head.toString('ascii', offset, offset + 4), length = head.readUInt32LE(offset + 4), body = offset + 8
      if (id === 'ds64' && body + 16 <= head.length) ds64DataBytes = Number(head.readBigUInt64LE(body + 8))
      if (id === 'fmt ' && body + 16 <= head.length) {
        let tag = head.readUInt16LE(body)
        if (tag === 0xfffe && body + 26 <= head.length) tag = head.readUInt16LE(body + 24)
        if (tag !== 1 && tag !== 3) throw new Error('录制声音文件的采样格式不支持')
        fmt = { format: tag === 3 ? 'float' : 'pcm', channels: head.readUInt16LE(body + 2), sampleRate: head.readUInt32LE(body + 4), blockAlign: head.readUInt16LE(body + 12), bitsPerSample: head.readUInt16LE(body + 14) }
        if (!fmt.channels || !fmt.sampleRate || fmt.blockAlign !== fmt.channels * fmt.bitsPerSample / 8) throw new Error('录制声音文件的格式信息无效')
      }
      if (id === 'data') {
        if (!fmt) throw new Error('录制声音文件缺少格式信息')
        const available = Math.floor(Math.max(0, size - body) / fmt.blockAlign) * fmt.blockAlign
        const declared = riff === 'RF64' && length === 0xffffffff ? ds64DataBytes ?? 0 : length
        // 正常收尾的文件按头里的长度读（后面可能还有别的块）；头里还是占位值或比文件长时，按实际写到的完整帧读。
        const dataBytes = declared > 0 && declared <= available ? declared - declared % fmt.blockAlign : available
        return { ...fmt, dataOffset: body, dataBytes, unfinished: declared !== dataBytes, dataSizeOffset: offset + 4, rf64: riff === 'RF64' }
      }
      offset = body + length + (length & 1)
    }
    throw new Error('录制声音文件没有采样数据')
  } finally { await handle.close() }
}

/** 按实际写到的完整采样帧补齐头里的长度，采样数据一字节不动；返回帧数。 */
export async function repairWavHeader(file: string): Promise<{ layout: WavLayout; frames: number }> {
  const layout = await readWavLayout(file)
  if (layout.unfinished && !layout.rf64) {
    const handle = await fs.open(file, 'r+')
    try {
      const size = Buffer.alloc(4)
      size.writeUInt32LE(layout.dataOffset - 8 + layout.dataBytes); await handle.write(size, 0, 4, 4)
      size.writeUInt32LE(layout.dataBytes); await handle.write(size, 0, 4, layout.dataSizeOffset)
      await handle.sync()
    } finally { await handle.close() }
  }
  return { layout: { ...layout, unfinished: false }, frames: layout.dataBytes / layout.blockAlign }
}

/** 标准 44 字节头；超过 4 GiB 时写 RF64（ds64 块记 64 位长度）。 */
export function wavHeader(layout: Pick<WavLayout, 'format' | 'channels' | 'sampleRate' | 'bitsPerSample' | 'blockAlign'>, dataBytes: number): Buffer {
  const pad = dataBytes & 1
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii'); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(layout.format === 'float' ? 3 : 1, 8); fmt.writeUInt16LE(layout.channels, 10)
  fmt.writeUInt32LE(layout.sampleRate, 12); fmt.writeUInt32LE(layout.sampleRate * layout.blockAlign, 16); fmt.writeUInt16LE(layout.blockAlign, 20); fmt.writeUInt16LE(layout.bitsPerSample, 22)
  const large = dataBytes + pad + 36 > 0xffffffff
  const head = Buffer.alloc(large ? 48 : 12)
  head.write(large ? 'RF64' : 'RIFF', 0, 'ascii'); head.write('WAVE', 8, 'ascii')
  if (large) {
    head.writeUInt32LE(0xffffffff, 4); head.write('ds64', 12, 'ascii'); head.writeUInt32LE(28, 16)
    head.writeBigUInt64LE(BigInt(4 + 36 + 24 + 8 + dataBytes + pad), 20); head.writeBigUInt64LE(BigInt(dataBytes), 28); head.writeBigUInt64LE(BigInt(dataBytes / layout.blockAlign), 36); head.writeUInt32LE(0, 44)
  } else head.writeUInt32LE(36 + dataBytes + pad, 4)
  const data = Buffer.alloc(8)
  data.write('data', 0, 'ascii'); data.writeUInt32LE(large ? 0xffffffff : dataBytes, 4)
  return Buffer.concat([head, fmt, data])
}

/** 交错采样 → 每声道浮点；只用于拼接处的少量采样。 */
export function decodeWavFrames(bytes: Buffer, layout: Pick<WavLayout, 'format' | 'channels' | 'bitsPerSample' | 'blockAlign'>): Float32Array[] {
  const frames = bytes.length / layout.blockAlign, width = layout.bitsPerSample / 8
  const channels = Array.from({ length: layout.channels }, () => new Float32Array(frames))
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < layout.channels; channel++) {
    const at = frame * layout.blockAlign + channel * width
    channels[channel][frame] = layout.format === 'float' ? bytes.readFloatLE(at)
      : width === 2 ? bytes.readInt16LE(at) / 0x8000 : width === 3 ? bytes.readIntLE(at, 3) / 0x800000 : bytes.readInt32LE(at) / 0x80000000
  }
  return channels
}
export function encodeWavFrames(channels: readonly Float32Array[], layout: Pick<WavLayout, 'format' | 'channels' | 'bitsPerSample' | 'blockAlign'>): Buffer {
  const frames = channels[0]?.length ?? 0, width = layout.bitsPerSample / 8
  const bytes = Buffer.alloc(frames * layout.blockAlign)
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < layout.channels; channel++) {
    const at = frame * layout.blockAlign + channel * width, value = channels[channel][frame]
    if (layout.format === 'float') { bytes.writeFloatLE(value, at); continue }
    const clamped = Math.max(-1, Math.min(1, value)), scale = width === 2 ? 0x8000 : width === 3 ? 0x800000 : 0x80000000
    const integer = Math.max(-scale, Math.min(scale - 1, Math.round(clamped * scale)))
    if (width === 2) bytes.writeInt16LE(integer, at); else if (width === 3) bytes.writeIntLE(integer, at, 3); else bytes.writeInt32LE(integer, at)
  }
  return bytes
}
