import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { getMediaCacheManager } from '../media/media-cache-runtime'

/*
 * 音频派生文件的“来历”：文件 X 与它的父文件 Y 在同一帧位置上除 dirty 帧区间外样本逐值相同（文件头可能不同，例如一份由 FFmpeg 写出）。
 * 由生成 X 的一方记下（它知道两版声音差在哪里），波形、频谱据此从 Y 的派生物只重算 dirty 附近的部分。
 * 两者长度可以不同（补录拼接）：这时从两者较短长度起，X 的尾部必须整段在 dirty 里。
 *
 * 记录连同双方的文件戳（大小、纳秒修改时间、inode）保存：任何一方被删掉重建，文件戳就对不上，这条来历随之失效；
 * 缓存清理删掉记录也只是失去增量，不影响正确性。没有父文件的记录是“根”：表示这份文件之后可能被派生，它的派生物值得把增量要用的中间数据一起留下。
 * 缓存目录里的文件把记录放在旁边（`X.lineage.json`，父文件按同目录文件名引用）；录音目录等用户目录里的文件、
 * 或父文件在别的目录时，记录放到缓存根下的 audio-lineage-v1/（按路径哈希命名，父文件按绝对路径引用），不往用户目录写东西。
 */

export type AudioLineageRange = [start: number, end: number]
interface LineageParent { name?: string; path?: string; stamp: string; dirty: AudioLineageRange[]; frames?: number }
interface LineageRecord { format: 'audio-lineage-v1'; stamp: string; frames: number; parent?: LineageParent }

/** 沿来历往上最多找几代：连续快速编辑时中间几版的派生物可能还没生成。 */
const MAX_HOPS = 8
const memory = new Map<string, LineageRecord | null>()
const MEMORY_LIMIT = 256
let centralOverride: string | undefined

/** 文件戳：大小、纳秒修改时间、inode。改名不变，文件被重写或删掉重建就变。 */
export async function audioFileStamp(file: string): Promise<string | undefined> {
  const stat = await fs.stat(file, { bigint: true }).catch(() => undefined)
  return stat?.isFile() ? `${stat.size}:${stat.mtimeNs}:${stat.ino}` : undefined
}

/** 缓存目录里的小记录文件：先写临时文件再改名，读者只会看到完整的旧版或新版。写不进去只影响以后能否增量，不抛错。 */
export async function writeAudioCacheRecord(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(temporary, JSON.stringify(value), 'utf8')
    await fs.rename(temporary, file)
  } catch {
    await removeUnmanagedCachePath(temporary, { force: true }).catch(() => undefined)
  }
}

const besidePath = (file: string): string => `${file}.lineage.json`
function centralDirectory(): string | undefined {
  try { return centralOverride ?? getMediaCacheManager().categoryDirectory('audio_edit', 'audio-lineage-v1') } catch { return undefined }
}
/** 不同写法（大小写、相对路径）指向同一文件时用同一条记录。 */
async function canonical(file: string): Promise<string> {
  const resolved = await fs.realpath(file).catch(() => path.resolve(file))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
async function centralPath(file: string): Promise<string | undefined> {
  const directory = centralDirectory()
  return directory ? path.join(directory, `${createHash('sha256').update(await canonical(file)).digest('hex')}.json`) : undefined
}

function remember(key: string, record: LineageRecord | null): void {
  memory.delete(key)
  memory.set(key, record)
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value as string)
}

const isRange = (range: unknown): range is AudioLineageRange => Array.isArray(range) && Number.isSafeInteger(range[0]) && Number.isSafeInteger(range[1]) && range[1] > range[0] && range[0] >= 0
function parseRecord(text: string): LineageRecord | null {
  const value = JSON.parse(text) as LineageRecord
  if (value?.format !== 'audio-lineage-v1' || typeof value.stamp !== 'string' || !Number.isSafeInteger(value.frames)) return null
  const parent = value.parent
  if (!parent) return value
  const reference = typeof parent.name === 'string' ? !/[\\/]/.test(parent.name) : typeof parent.path === 'string' && path.isAbsolute(parent.path)
  if (!reference || typeof parent.stamp !== 'string' || !Array.isArray(parent.dirty) || !parent.dirty.every(isRange)) return null
  if (parent.frames !== undefined && parent.frames !== value.frames) {
    // 长度不同的两版：从较短长度起的尾部必须整段在 dirty 里，否则读者会把对不上位置的旧数据当成没变。
    if (!Number.isSafeInteger(parent.frames) || parent.frames < 1) return null
    const tail = Math.min(parent.frames, value.frames)
    if (tail < value.frames && !parent.dirty.some(([start, end]) => start <= tail && end >= value.frames)) return null
  }
  return value
}

async function load(file: string): Promise<LineageRecord | undefined> {
  const key = await canonical(file)
  let record = memory.get(key)
  if (record === undefined) {
    const read = async (location: string | undefined): Promise<LineageRecord | null> => location ? fs.readFile(location, 'utf8').then(parseRecord, () => null).catch(() => null) : null
    record = await read(besidePath(file)) ?? await read(await centralPath(file))
    remember(key, record)
  }
  if (!record || await audioFileStamp(file) !== record.stamp) return undefined
  return record
}

/**
 * 记下 file 的来历：parent 除 dirty 外与 file 同位置的样本相同；不给 parent 记为根。parent.frames 与 frames 不同时，dirty 要盖住尾部。
 * stampFrom：file 还没发布时它的临时文件（改名不改文件戳），发布前就把来历写好，读者一看到 file 就能查到来历。
 * central：file 在用户目录里（录音），记录写到缓存根下；父文件在别的目录时同样写到那里。
 */
export async function recordAudioLineage(file: string, frames: number, parent?: { file: string; dirty: readonly AudioLineageRange[]; frames?: number }, options: { stampFrom?: string; central?: boolean } = {}): Promise<void> {
  const stamp = await audioFileStamp(options.stampFrom ?? file)
  if (!stamp) return
  let record: LineageRecord = { format: 'audio-lineage-v1', stamp, frames }
  let central = Boolean(options.central)
  if (parent && path.resolve(parent.file) !== path.resolve(file)) {
    const parentStamp = await audioFileStamp(parent.file)
    const nearby = path.dirname(parent.file) === path.dirname(file)
    central ||= !nearby
    if (parentStamp) {
      record = { ...record, parent: {
        ...(central ? { path: await canonical(parent.file) } : { name: path.basename(parent.file) }), stamp: parentStamp, dirty: parent.dirty.map(([start, end]) => [start, end]),
        ...(parent.frames !== undefined && parent.frames !== frames ? { frames: parent.frames } : {}),
      } }
    }
  }
  const location = central ? await centralPath(file) : besidePath(file)
  if (!location) return
  remember(await canonical(file), record)
  await writeAudioCacheRecord(location, record)
}

/** file 还没有任何来历记录时记为根（用户目录里的自管素材在缓存根下记）；已有记录不动。 */
export async function ensureAudioLineageRoot(file: string, frames: number): Promise<void> {
  if (await load(file)) return
  await recordAudioLineage(file, frames, undefined, { central: true })
}

/** file 有没有有效的来历记录（含根）：有就说明它属于会被增量派生的那一类文件。 */
export async function audioLineageTracked(file: string): Promise<boolean> {
  return Boolean(await load(file))
}

/**
 * 沿来历向上找第一个 accept 认可的祖先（通常是派生物已生成的那一版），返回它与 file 之间所有可能不同的帧（各代合并，裁到 file 的长度）。
 * 中途长度变过时，变化处之后整段都在 dirty 里，所以按同位置合并仍然成立。accept 同时拿到祖先的长度；任何一代的文件戳对不上就停下。
 */
export async function findAudioLineageAncestor<T>(file: string, accept: (ancestor: string, dirty: readonly AudioLineageRange[], ancestorFrames: number) => Promise<T | undefined>): Promise<{ ancestor: string; value: T; dirty: AudioLineageRange[]; hops: number; frames: number; ancestorFrames: number } | undefined> {
  const first = await load(file)
  if (!first?.parent) return undefined
  const dirty: AudioLineageRange[] = []
  let current = file
  let record: LineageRecord | undefined = first
  let frames = first.frames
  for (let hops = 1; hops <= MAX_HOPS && record?.parent; hops++) {
    const parent = record.parent.path ?? path.join(path.dirname(current), record.parent.name!)
    if (await audioFileStamp(parent) !== record.parent.stamp) return undefined
    const parentFrames = record.parent.frames ?? record.frames
    dirty.push(...record.parent.dirty)
    // 任何一代比 file 短，file 在它之后的部分都没有对应的旧数据。
    if (parentFrames < first.frames) dirty.push([parentFrames, first.frames])
    const merged = mergeRanges(dirty, first.frames)
    frames = parentFrames
    const value = await accept(parent, merged, frames)
    if (value !== undefined) return { ancestor: parent, value, dirty: merged, hops, frames: first.frames, ancestorFrames: frames }
    current = parent
    record = await load(parent)
    if (record && record.frames !== parentFrames) return undefined
  }
  return undefined
}

function mergeRanges(ranges: readonly AudioLineageRange[], limit: number): AudioLineageRange[] {
  const merged: AudioLineageRange[] = []
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(0, start), to = Math.min(limit, end)
    if (to <= from) continue
    const last = merged.at(-1)
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  return merged
}

/** 仅供测试：清空内存里的记录，并把集中存放的记录指到临时目录。 */
export function resetAudioLineageForTests(directory?: string): void {
  memory.clear()
  centralOverride = directory
}
