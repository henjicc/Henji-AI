import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import type { AudioEditSourceFingerprint, AudioEditSourceIdentity, AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import { createMainLogger } from '../logging'

/*
 * 口播素材的身份。
 *
 * 外部素材（格式 8 起导入、重新定位）存采样指纹（henji-audio-fingerprint-v1）：SHA-256（版本标签、文件大小、各采样块的偏移与字节）。
 * 16 MiB 以内整文件；更大的文件取头 256 KiB、尾 256 KiB 与 33 个以 (i+0.5)/33 处为中心的 64 KiB 块（含正中间），
 * 读量与文件大小无关。截断、追加必然改变大小；换成另一段录音时容器头尾与分散的采样块几乎必然不同。
 * 同大小、只改了未采样位置（例如对几秒降噪后原样保存）认不出，所以指纹只用来快速判定“还是不是那份文件”，
 * 派生缓存键总带上文件当前的大小与修改时间。
 *
 * 整文件 SHA-256（identity）覆盖全部内容：格式 8 之前导入的素材带它（语义不变，已有缓存继续命中）；
 * 应用自己写出的拼接结果在写出时顺带算出它（写的时候本来就经手全部字节，不额外读），所以等长覆盖一句话也一定换键。
 */

const logger = createMainLogger('main.audio_edit')
// 无读取进展的退出预算，与素材总长度无关。
const SOURCE_IDLE_TIMEOUT_MS = 30_000
const FINGERPRINT_TAG = 'henji-audio-fingerprint-v1'
const WHOLE_FILE_BYTES = 16 * 1024 * 1024
const EDGE_BYTES = 256 * 1024
const BLOCK_BYTES = 64 * 1024
const BLOCKS = 33

/**
 * 采样块 [偏移, 长度]，按偏移排序；16 MiB 以内是整个文件。超过 16 MiB 时块间距至少约 500 KiB，
 * 中间块夹在头尾之间，互不重叠。
 */
function fingerprintBlocks(size: number): Array<[number, number]> {
  if (size <= WHOLE_FILE_BYTES) return [[0, size]]
  const middle = Array.from({ length: BLOCKS }, (_, index): [number, number] => {
    const center = Math.floor((index + 0.5) * size / BLOCKS)
    return [Math.max(EDGE_BYTES, Math.min(size - EDGE_BYTES - BLOCK_BYTES, center - BLOCK_BYTES / 2)), BLOCK_BYTES]
  })
  return [[0, EDGE_BYTES], ...middle, [size - EDGE_BYTES, EDGE_BYTES]]
}

const u64 = (value: number): Buffer => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes }

/** 素材指纹；读取期间文件被改写时报错。 */
export async function fingerprintAudioEditSource(file: string, signal?: AbortSignal): Promise<AudioEditSourceFingerprint> {
  signal?.throwIfAborted()
  const started = performance.now()
  const before = await fs.stat(file)
  const blocks = fingerprintBlocks(before.size)
  const handle = await fs.open(file, 'r')
  const hash = crypto.createHash('sha256').update(`${FINGERPRINT_TAG}\0`).update(u64(before.size))
  try {
    // 采样块并发读：机械盘上由系统按位置排序寻道，固态盘上几毫秒。
    const parts = await Promise.all(blocks.map(async ([offset, length]) => {
      const bytes = Buffer.alloc(length)
      let done = 0
      while (done < length) {
        signal?.throwIfAborted()
        const { bytesRead } = await handle.read(bytes, done, length - done, offset + done)
        if (!bytesRead) throw new Error('素材读取不完整，请检查文件所在磁盘后重试。')
        done += bytesRead
      }
      return bytes
    }))
    blocks.forEach(([offset], index) => hash.update(u64(offset)).update(parts[index]))
  } finally { await handle.close() }
  signal?.throwIfAborted()
  const after = await fs.stat(file)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('素材正在被修改，请稍后重新导入。')
  const readBytes = blocks.reduce((sum, [, length]) => sum + length, 0)
  logger.debug('素材指纹完成', { event: 'audio_edit.source.fingerprint.completed', context: { bytes: after.size, readBytes, mode: blocks.length === 1 ? 'whole' : 'sampled', elapsedMs: performance.now() - started } })
  return { size: after.size, mtimeMs: after.mtimeMs, digest: hash.digest('hex') }
}

/** 整文件 SHA-256（只给带 identity 的素材用：大小或修改时间对不上、重新定位时）。 */
export async function digestWholeAudioEditSource(sourcePath: string, signal?: AbortSignal): Promise<AudioEditSourceIdentity> {
  signal?.throwIfAborted()
  const before = await fs.stat(sourcePath)
  const digest = crypto.createHash('sha256')
  const stream = createReadStream(sourcePath, { signal })
  const timer = setTimeout(() => stream.destroy(new Error('素材读取长时间没有进展，请检查文件所在磁盘后重试。')), SOURCE_IDLE_TIMEOUT_MS)
  timer.unref()
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      timer.refresh()
      digest.update(chunk)
    }
  } finally { clearTimeout(timer); stream.destroy() }
  signal?.throwIfAborted()
  const after = await fs.stat(sourcePath)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('素材正在被修改，请稍后重新导入。')
  return { size: after.size, mtimeMs: after.mtimeMs, digest: digest.digest('hex') }
}

/**
 * 派生缓存（浮点副本、渲染、频谱）按内容寻址的键。
 * - 整文件摘要：内容不同键就不同。只有它时（格式 8 之前导入、应用写出的拼接结果）直接用它，校验在大小或修改时间变了时会整文件比对；
 *   同时带指纹（重新定位过的旧作品，校验只比指纹）时，大小与修改时间对得上才直接用，对不上连同当前大小与修改时间。
 * - 只有采样指纹：总连同文件当前的大小与修改时间，改在未采样位置的文件也换键。
 */
export async function audioEditSourceContentKey(source: Pick<AudioEditSourceMetadata, 'sourcePath' | 'identity' | 'fingerprint'>, signal?: AbortSignal): Promise<string> {
  const { identity } = source
  if (identity && !source.fingerprint) return identity.digest
  const stat = await fs.stat(source.sourcePath)
  if (identity && stat.size === identity.size && stat.mtimeMs === identity.mtimeMs) return identity.digest
  const digest = identity?.digest ?? (source.fingerprint ?? await unrecordedFingerprint(source.sourcePath, stat, signal)).digest
  return crypto.createHash('sha256').update(JSON.stringify([FINGERPRINT_TAG, digest, stat.size, stat.mtimeMs])).digest('hex')
}

/** 作品里没有任何身份记录（极早期导入）的素材：频谱逐块取键时会反复问到，按文件与大小、修改时间记住算过的指纹。 */
const unrecorded = new Map<string, AudioEditSourceFingerprint>()
async function unrecordedFingerprint(file: string, stat: { size: number; mtimeMs: number }, signal?: AbortSignal): Promise<AudioEditSourceFingerprint> {
  const held = unrecorded.get(file)
  if (held?.size === stat.size && held.mtimeMs === stat.mtimeMs) return held
  const fingerprint = await fingerprintAudioEditSource(file, signal)
  unrecorded.delete(file)
  unrecorded.set(file, fingerprint)
  while (unrecorded.size > 64) unrecorded.delete(unrecorded.keys().next().value as string)
  return fingerprint
}

/**
 * 转写回执里记录“基于哪份素材”的字符串：带整文件摘要的记摘要、没有身份记录的记路径（与已存回执一致），
 * 只有采样指纹的记 [摘要, 大小, 修改时间]——不带路径：素材移动后重新定位，已付费的识别结果照样复用。
 */
export function audioEditSourceReceiptDigest(source: Pick<AudioEditSourceMetadata, 'sourcePath' | 'identity' | 'fingerprint'>): string {
  const { identity, fingerprint } = source
  return identity?.digest ?? (fingerprint ? JSON.stringify([fingerprint.digest, fingerprint.size, fingerprint.mtimeMs]) : source.sourcePath)
}
