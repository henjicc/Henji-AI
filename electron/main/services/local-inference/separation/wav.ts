import fs from 'node:fs/promises'

/*
 * 32 位浮点 WAV 的读写（人声分离的输出格式，也用来读 FFmpeg 经管道吐出的解码结果）。
 *
 * - 写：输出长度在开始前就已知（与输入等长），文件头一次写对，之后顺序追加交错样本；
 *   1–2 声道用 IEEE float（格式 3，带 fact 块），多声道用 WAVE_FORMAT_EXTENSIBLE（子格式 IEEE float）。
 * - 读：只解析文件头，找到 fmt 与 data 块；管道输出的 data 大小是 0xFFFFFFFF，表示读到结尾为止。
 */

export const WAV_MAX_DATA_BYTES = 0xFFFF_FFFF - 128

const FLOAT_SUBFORMAT = Uint8Array.of(0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71)

export interface WavFormat { sampleRate: number; channels: number }

export function float32WavHeader(format: WavFormat, frames: number): Uint8Array {
  const { sampleRate, channels } = format
  const dataBytes = frames * channels * 4
  if (dataBytes > WAV_MAX_DATA_BYTES) throw new Error('输出超过 WAV 文件 4 GB 的上限。')
  const extensible = channels > 2
  const fmtBytes = extensible ? 40 : 18
  const header = new Uint8Array(12 + 8 + fmtBytes + 12 + 8)
  const view = new DataView(header.buffer)
  const ascii = (offset: number, text: string): void => { for (let index = 0; index < text.length; index++) header[offset + index] = text.charCodeAt(index) }
  ascii(0, 'RIFF'); view.setUint32(4, header.length - 8 + dataBytes, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, fmtBytes, true)
  view.setUint16(20, extensible ? 0xfffe : 3, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 4, true)
  view.setUint16(32, channels * 4, true)
  view.setUint16(34, 32, true)
  view.setUint16(36, extensible ? 22 : 0, true)
  if (extensible) { view.setUint16(38, 32, true); view.setUint32(40, 0, true); header.set(FLOAT_SUBFORMAT, 44) }
  const fact = 20 + fmtBytes
  ascii(fact, 'fact'); view.setUint32(fact + 4, 4, true); view.setUint32(fact + 8, frames, true)
  ascii(fact + 12, 'data'); view.setUint32(fact + 16, dataBytes, true)
  return header
}

export interface ParsedWavHeader extends WavFormat {
  /** 样本数据在文件里的起点。 */
  dataOffset: number
  /** data 块声明的字节数；管道输出（未知长度）为 null。 */
  dataBytes: number | null
}

/**
 * 解析 32 位浮点 WAV 的文件头；字节不够时返回 null（调用方再多读一些），格式不对时抛错。
 */
export function parseFloat32WavHeader(bytes: Uint8Array): ParsedWavHeader | null {
  if (bytes.length < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number): string => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('不是 WAV 数据。')
  let format: WavFormat | undefined
  for (let offset = 12; ;) {
    if (offset + 8 > bytes.length) return null
    const id = tag(offset), size = view.getUint32(offset + 4, true)
    if (id === 'data') {
      if (!format) throw new Error('WAV 缺少 fmt 块。')
      return { ...format, dataOffset: offset + 8, dataBytes: size === 0xFFFF_FFFF || size === 0 ? null : size }
    }
    if (id === 'fmt ') {
      if (offset + 8 + Math.min(size, 40) > bytes.length) return null
      const formatTag = view.getUint16(offset + 8, true)
      const bits = view.getUint16(offset + 22, true)
      const float = formatTag === 3 || (formatTag === 0xfffe && size >= 40 && FLOAT_SUBFORMAT.every((value, index) => bytes[offset + 32 + index] === value))
      if (!float || bits !== 32) throw new Error('WAV 不是 32 位浮点。')
      format = { channels: view.getUint16(offset + 10, true), sampleRate: view.getUint32(offset + 12, true) }
      if (!format.channels || !format.sampleRate) throw new Error('WAV 声道数或采样率无效。')
    }
    offset += 8 + size + (size % 2)
  }
}

/** 顺序写一个长度已知的 32 位浮点 WAV；写满声明的帧数才能正常关闭。 */
export class Float32WavWriter {
  private written = 0
  private constructor(private readonly handle: fs.FileHandle, readonly path: string, readonly format: WavFormat, readonly frames: number) {}

  static async create(path: string, format: WavFormat, frames: number): Promise<Float32WavWriter> {
    const header = float32WavHeader(format, frames)
    const handle = await fs.open(path, 'w')
    try { await handle.write(header) } catch (error) { await handle.close().catch(() => undefined); throw error }
    return new Float32WavWriter(handle, path, format, frames)
  }

  /** 追加交错样本（长度为声道数的整数倍）。 */
  async write(interleaved: Float32Array): Promise<void> {
    const frames = interleaved.length / this.format.channels
    if (!Number.isInteger(frames) || this.written + frames > this.frames) throw new Error('写入的样本数与声明的长度不符。')
    await this.handle.write(new Uint8Array(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength))
    this.written += frames
  }

  async close(): Promise<void> {
    await this.handle.close()
    if (this.written !== this.frames) throw new Error(`WAV 只写了 ${this.written} / ${this.frames} 帧。`)
  }

  /** 出错时关闭句柄（不校验长度，文件由调用方删除）。 */
  async discard(): Promise<void> { await this.handle.close().catch(() => undefined) }
}
