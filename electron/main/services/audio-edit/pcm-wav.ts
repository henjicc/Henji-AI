import type { Hash } from 'node:crypto'
import fs from 'node:fs/promises'

/*
 * 32 位浮点 WAV 的随机读、顺序写与原位改写一段：口播成片逐段拼接（交叉淡化要读被删部分紧挨着的声音）、
 * 编辑后声音只重算改动的帧都直接读写样本，不经 FFmpeg。支持 RIFF 与超过 4 GB 的 RF64；不是浮点 WAV 时由调用方先转码。
 */

export interface F32WavReader {
  sampleRate: number
  channels: number
  frames: number
  /** 越界部分补零。传入 into（长度须为 frameCount × 声道数）时读进它并返回它，整段处理可复用同一块缓冲。 */
  read(startFrame: number, frameCount: number, into?: Float32Array): Promise<Float32Array>
  close(): Promise<void>
}

const WAVE_FORMAT_IEEE_FLOAT = 3
const WAVE_FORMAT_EXTENSIBLE = 0xfffe

interface F32WavLayout { sampleRate: number; channels: number; frames: number; dataOffset: number }

/** 读 RIFF / RF64 头：不是 32 位浮点 WAV 时返回 null。 */
async function readF32WavLayout(handle: fs.FileHandle): Promise<F32WavLayout | null> {
  const head = Buffer.alloc(12)
  await handle.read(head, 0, 12, 0)
  const riff = head.toString('ascii', 0, 4)
  if ((riff !== 'RIFF' && riff !== 'RF64') || head.toString('ascii', 8, 12) !== 'WAVE') return null
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
  if (format !== WAVE_FORMAT_IEEE_FLOAT || bits !== 32 || !channels || !sampleRate || dataOffset < 0) return null
  return { sampleRate, channels, frames: Math.floor(dataSize / (4 * channels)), dataOffset }
}

/**
 * 原位改写已有 32 位浮点 WAV 的一段样本（编辑后声音只重算改动的帧时用）；不是浮点 WAV 返回 null。
 * 只改写数据区里已有的帧，不改文件长度与头。
 */
export async function openF32WavForPatch(path: string): Promise<{ sampleRate: number; channels: number; frames: number; write(startFrame: number, pcm: Float32Array): Promise<void>; close(): Promise<void> } | null> {
  const handle = await fs.open(path, 'r+')
  try {
    const layout = await readF32WavLayout(handle)
    if (!layout) { await handle.close(); return null }
    const { channels, frames, dataOffset } = layout
    return {
      ...layout,
      async write(startFrame, pcm) {
        const count = pcm.length / channels
        if (!Number.isInteger(count) || startFrame < 0 || startFrame + count > frames) throw new Error('改写范围超出声音长度')
        const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
        let done = 0
        while (done < bytes.length) {
          const { bytesWritten } = await handle.write(bytes, done, bytes.length - done, dataOffset + startFrame * channels * 4 + done)
          if (!bytesWritten) throw new Error('声音文件写入没有进展')
          done += bytesWritten
        }
      },
      close: () => handle.close(),
    }
  } catch (error) { await handle.close().catch(() => undefined); throw error }
}

/** 解析失败返回 null（不是 32 位浮点 WAV），不抛错。 */
export async function openF32Wav(path: string): Promise<F32WavReader | null> {
  const handle = await fs.open(path, 'r')
  try {
    const layout = await readF32WavLayout(handle)
    if (!layout) { await handle.close(); return null }
    const { sampleRate, channels, frames, dataOffset } = layout
    return {
      sampleRate, channels, frames,
      async read(startFrame, frameCount, into) {
        const length = Math.max(0, frameCount) * channels
        if (into && into.length !== length) throw new Error('读取缓冲长度与帧数不符')
        const output = into ?? new Float32Array(length)
        const from = Math.max(0, startFrame), to = Math.min(frames, startFrame + frameCount)
        const at = Math.max(0, (from - startFrame) * channels), filled = Math.max(0, to - from) * channels
        // 直接读进输出缓冲，不经中间 Buffer；复用的缓冲把读不到的部分清零。
        if (into) { output.fill(0, 0, Math.min(at, length)); output.fill(0, Math.min(length, at + filled)) }
        if (filled > 0) {
          const bytes = new Uint8Array(output.buffer, output.byteOffset + at * 4, filled * 4)
          let done = 0
          while (done < bytes.length) {
            const { bytesRead } = await handle.read(bytes, done, bytes.length - done, dataOffset + from * channels * 4 + done)
            if (!bytesRead) { bytes.fill(0, done); break }
            done += bytesRead
          }
        }
        return output
      },
      close: () => handle.close(),
    }
  } catch (error) { await handle.close().catch(() => undefined); throw error }
}

/**
 * 写 32 位浮点 WAV：帧数事先已知，头部一次写对；数据超过 4 GB 时写 RF64。
 * 传入 hash 时按文件字节顺序把头与数据都喂给它，写完即得整个文件的摘要，不必再读一遍。
 */
export async function createF32WavWriter(path: string, sampleRate: number, channels: number, frames: number, hash?: Hash): Promise<{ write(pcm: Float32Array): Promise<void>; close(): Promise<void> }> {
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
  try { await handle.write(header, 0, header.length, 0); position = header.length; hash?.update(header) } catch (error) { await handle.close(); throw error }
  return {
    async write(pcm) {
      const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      hash?.update(bytes)
      await handle.write(bytes, 0, bytes.length, position)
      position += bytes.length
    },
    close: () => handle.close(),
  }
}
