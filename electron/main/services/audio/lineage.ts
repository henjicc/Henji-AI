import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'

/*
 * 音频派生文件的“来历”：浮点 WAV X 与同目录的浮点 WAV Y 除 dirty 帧区间外样本逐值相同（文件头可能不同，例如一份由 FFmpeg 写出）。
 * 由生成编辑后声音的一方记下（它知道两版声音差在哪里），波形、频谱据此从 Y 的派生物只重算 dirty 附近的部分。
 *
 * 记录连同双方的文件戳（大小、纳秒修改时间、inode）落在 X 旁边的 `X.lineage.json`：任何一方被删掉重建，文件戳就对不上，
 * 这条来历随之失效；缓存清理删掉记录也只是失去增量，不影响正确性。没有 parent 的记录是“根”：
 * 表示这份文件之后可能被派生，它的派生物值得把增量要用的中间数据一起留下。
 */

export type AudioLineageRange = [start: number, end: number]
interface LineageRecord { format: 'audio-lineage-v1'; stamp: string; frames: number; parent?: { name: string; stamp: string; dirty: AudioLineageRange[] } }

/** 沿来历往上最多找几代：连续快速编辑时中间几版的派生物可能还没生成。 */
const MAX_HOPS = 8
const memory = new Map<string, LineageRecord | null>()
const MEMORY_LIMIT = 256

/** 文件戳：大小、纳秒修改时间、inode。改名不变，文件被重写或删掉重建就变。 */
export async function audioFileStamp(file: string): Promise<string | undefined> {
  const stat = await fs.stat(file, { bigint: true }).catch(() => undefined)
  return stat?.isFile() ? `${stat.size}:${stat.mtimeNs}:${stat.ino}` : undefined
}

/** 缓存目录里的小记录文件：先写临时文件再改名，读者只会看到完整的旧版或新版。写不进去只影响以后能否增量，不抛错。 */
export async function writeAudioCacheRecord(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(value), 'utf8')
    await fs.rename(temporary, file)
  } catch {
    await removeUnmanagedCachePath(temporary, { force: true }).catch(() => undefined)
  }
}

const recordPath = (file: string): string => `${file}.lineage.json`

function remember(file: string, record: LineageRecord | null): void {
  memory.delete(file)
  memory.set(file, record)
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value as string)
}

function parseRecord(text: string): LineageRecord | null {
  const value = JSON.parse(text) as LineageRecord
  if (value?.format !== 'audio-lineage-v1' || typeof value.stamp !== 'string' || !Number.isSafeInteger(value.frames)) return null
  if (value.parent && (typeof value.parent.name !== 'string' || /[\\/]/.test(value.parent.name) || typeof value.parent.stamp !== 'string' || !Array.isArray(value.parent.dirty)
    || !value.parent.dirty.every(range => Array.isArray(range) && Number.isSafeInteger(range[0]) && Number.isSafeInteger(range[1]) && range[1] > range[0] && range[0] >= 0))) return null
  return value
}

async function load(file: string): Promise<LineageRecord | undefined> {
  let record = memory.get(file)
  if (record === undefined) {
    record = await fs.readFile(recordPath(file), 'utf8').then(parseRecord, () => null).catch(() => null)
    remember(file, record)
  }
  if (!record || await audioFileStamp(file) !== record.stamp) return undefined
  return record
}

/**
 * 记下 file 的来历：parent 在同一目录、除 dirty 外样本与 file 相同；不给 parent 记为根。
 * stampFrom：file 还没发布时它的临时文件（改名不改文件戳），发布前就把来历写好，读者一看到 file 就能查到来历。
 */
export async function recordAudioLineage(file: string, frames: number, parent?: { file: string; dirty: readonly AudioLineageRange[] }, options: { stampFrom?: string } = {}): Promise<void> {
  const stamp = await audioFileStamp(options.stampFrom ?? file)
  if (!stamp) return
  let record: LineageRecord = { format: 'audio-lineage-v1', stamp, frames }
  if (parent && path.dirname(parent.file) === path.dirname(file) && parent.file !== file) {
    const parentStamp = await audioFileStamp(parent.file)
    if (parentStamp) record = { ...record, parent: { name: path.basename(parent.file), stamp: parentStamp, dirty: parent.dirty.map(([start, end]) => [start, end]) } }
  }
  remember(file, record)
  await writeAudioCacheRecord(recordPath(file), record)
}

/** file 有没有有效的来历记录（含根）：有就说明它属于会被增量派生的那一类文件。 */
export async function audioLineageTracked(file: string): Promise<boolean> {
  return Boolean(await load(file))
}

/**
 * 沿来历向上找第一个 accept 认可的祖先（通常是派生物已生成的那一版），返回它与 file 之间所有可能不同的帧（各代合并）。
 * accept 同时拿到到这一代为止合并好的不同帧；中途任何一代的文件戳对不上就停下。
 */
export async function findAudioLineageAncestor<T>(file: string, accept: (ancestor: string, dirty: readonly AudioLineageRange[]) => Promise<T | undefined>): Promise<{ ancestor: string; value: T; dirty: AudioLineageRange[]; hops: number; frames: number } | undefined> {
  const first = await load(file)
  if (!first?.parent) return undefined
  const dirty: AudioLineageRange[] = []
  let current = file
  let record: LineageRecord | undefined = first
  for (let hops = 1; hops <= MAX_HOPS && record?.parent; hops++) {
    if (record.frames !== first.frames) return undefined
    const parent = path.join(path.dirname(current), record.parent.name)
    if (await audioFileStamp(parent) !== record.parent.stamp) return undefined
    dirty.push(...record.parent.dirty)
    const merged = mergeRanges(dirty)
    const value = await accept(parent, merged)
    if (value !== undefined) return { ancestor: parent, value, dirty: merged, hops, frames: first.frames }
    current = parent
    record = await load(parent)
  }
  return undefined
}

function mergeRanges(ranges: readonly AudioLineageRange[]): AudioLineageRange[] {
  const merged: AudioLineageRange[] = []
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** 仅供测试：清空内存里的记录。 */
export function resetAudioLineageForTests(): void {
  memory.clear()
}
