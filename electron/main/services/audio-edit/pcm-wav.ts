import fs from 'node:fs/promises'

/*
 * 32 位浮点 WAV 的随机读与顺序写：口播成片在主进程逐段拼接（交叉淡化要读被删部分紧挨着的声音），
 * 不再交给 FFmpeg 的 concat 滤镜。支持 RIFF 与超过 4 GB 的 RF64；不是浮点 WAV 时由调用方先转码。
 */

export interface F32WavReader {
  sampleRate: number
  channels: number
  frames: number
  /** 越界部分补零 */
  read(startFrame: number, frameCount: number): Promise<Float32Array>
  close(): Promise<void>
}

const WAVE_FORMAT_IEEE_FLOAT = 3
const WAVE_FORMAT_EXTENSIBLE = 0xfffe

/** 解析失败返回 null（不是 32 位浮点 WAV），不抛错。 */
export async function openF32Wav(path: string): Promise<F32WavReader | null> {
  const handle = await fs.open(path, 'r')
  try {
    const head = Buffer.alloc(12)
    await handle.read(head, 0, 12, 0)
    const riff = head.toString('ascii', 0, 4)
    if ((riff !== 'RIFF' && riff !== 'RF64') || head.toString('ascii', 8, 12) !== 'WAVE') { await handle.close(); return null }
    let offset = 12, format = 0, channels = 0, sampleRate = 0, bits = 0, dataOffset = -1, dataSize = 0, ds64Data = 0
    const { size: fileSize } = await handle.stat()
    while (offset + 8 <= fileSize) {
      const chunk = Buffer.alloc(8)
      await handle.read(chunk, 0, 8, offset)
      const id = chunk.toString('ascii', 0, 4), size = chunk.readUInt32LE(4)
      if (id === 'ds64') {
        const body = Buffer.alloc(16)
        await handle.read(body, 0, 16, offset + 8)
        ds64Data = Number(body.readBigUInt64LE(8))
      } else if (id === 'fmt ') {
        const body = Buffer.alloc(Math.min(size, 40))
        await handle.read(body, 0, body.length, offset + 8)
        format = body.readUInt16LE(0); channels = body.readUInt16LE(2); sampleRate = body.readUInt32LE(4); bits = body.readUInt16LE(14)
        if (format === WAVE_FORMAT_EXTENSIBLE && body.length >= 26) format = body.readUInt16LE(24)
      } else if (id === 'data') {
        dataOffset = offset + 8
        dataSize = size === 0xffffffff && ds64Data ? ds64Data : Math.min(size, fileSize - dataOffset)
        break
      }
      offset += 8 + size + (size % 2)
    }
    if (format !== WAVE_FORMAT_IEEE_FLOAT || bits !== 32 || !channels || !sampleRate || dataOffset < 0) { await handle.close(); return null }
    const frames = Math.floor(dataSize / (4 * channels))
    return {
      sampleRate, channels, frames,
      async read(startFrame, frameCount) {
        const output = new Float32Array(Math.max(0, frameCount) * channels)
        const from = Math.max(0, startFrame), to = Math.min(frames, startFrame + frameCount)
        if (to > from) {
          const bytes = Buffer.alloc((to - from) * channels * 4)
          await handle.read(bytes, 0, bytes.length, dataOffset + from * channels * 4)
          output.set(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), (from - startFrame) * channels)
        }
        return output
      },
      close: () => handle.close(),
    }
  } catch (error) { await handle.close().catch(() => undefined); throw error }
}

/** 写 32 位浮点 WAV：帧数事先已知，头部一次写对；数据超过 4 GB 时写 RF64。 */
export async function createF32WavWriter(path: string, sampleRate: number, channels: number, frames: number): Promise<{ write(pcm: Float32Array): Promise<void>; close(): Promise<void> }> {
  const dataSize = frames * channels * 4
  const rf64 = dataSize + 80 > 0xffffffff
  const header = Buffer.alloc(rf64 ? 80 : 44)
  let at = 0
  const ascii = (text: string) => { header.write(text, at, 'ascii'); at += 4 }
  const u32 = (value: number) => { header.writeUInt32LE(value, at); at += 4 }
  ascii(rf64 ? 'RF64' : 'RIFF'); u32(rf64 ? 0xffffffff : header.length - 8 + dataSize); ascii('WAVE')
  if (rf64) {
    ascii('ds64'); u32(28)
    header.writeBigUInt64LE(BigInt(header.length - 8 + dataSize), at); at += 8
    header.writeBigUInt64LE(BigInt(dataSize), at); at += 8
    header.writeBigUInt64LE(BigInt(frames), at); at += 8
    u32(0)
  }
  ascii('fmt '); u32(16)
  header.writeUInt16LE(WAVE_FORMAT_IEEE_FLOAT, at); header.writeUInt16LE(channels, at + 2); at += 4
  u32(sampleRate); u32(sampleRate * channels * 4)
  header.writeUInt16LE(channels * 4, at); header.writeUInt16LE(32, at + 2); at += 4
  ascii('data'); u32(rf64 ? 0xffffffff : dataSize)
  const handle = await fs.open(path, 'w')
  let position = 0
  try { await handle.write(header, 0, header.length, 0); position = header.length } catch (error) { await handle.close(); throw error }
  return {
    async write(pcm) {
      const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      await handle.write(bytes, 0, bytes.length, position)
      position += bytes.length
    },
    close: () => handle.close(),
  }
}
