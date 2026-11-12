import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { writeAudioCacheRecord } from '../audio/lineage'
import type { AudioEditSoundSplice } from './sound-diff'

/*
 * 作品素材被补录拼接换成新文件的记录（作品缓存目录里的 source-splices.json）：旧声音身份 → 新声音身份与拼接位置。
 * 编辑后声音的上一版是按旧素材算的，据此把它的操作序列映射到新坐标再比较，不必因为换了素材就整段重算。
 * 可重建缓存：丢了只失去一次增量。
 */

export interface AudioEditSourceSplice extends AudioEditSoundSplice { from: string; to: string }

const FILE = 'source-splices.json'
/** 连续补录很多次而编辑后声音一直没被取过时，中间几次的记录也要在：留最近这么多条。 */
const LIMIT = 64
const frame = z.number().int().nonnegative()
const recordsSchema = z.object({ format: z.literal('audio-edit-source-splices-v1'), splices: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), start: frame, end: frame, inserted: z.number().int().positive() }).strict()) }).strict()

async function readSplices(directory: string): Promise<AudioEditSourceSplice[]> {
  const text = await fs.readFile(path.join(directory, FILE), 'utf8').catch(() => undefined)
  if (text === undefined) return []
  try { return recordsSchema.parse(JSON.parse(text)).splices } catch { return [] }
}

export async function recordAudioEditSourceSplice(directory: string, splice: AudioEditSourceSplice): Promise<void> {
  const splices = (await readSplices(directory)).filter(item => item.to !== splice.to)
  splices.push(splice)
  await writeAudioCacheRecord(path.join(directory, FILE), { format: 'audio-edit-source-splices-v1', splices: splices.slice(-LIMIT) })
}

/** 从声音身份 from 依次拼接到 to 的记录；接不上返回 undefined。 */
export async function findAudioEditSourceSplices(directory: string, from: string, to: string): Promise<AudioEditSourceSplice[] | undefined> {
  const byOrigin = new Map((await readSplices(directory)).map(splice => [splice.from, splice]))
  const chain: AudioEditSourceSplice[] = []
  for (let current = from; current !== to;) {
    const next = byOrigin.get(current)
    if (!next || chain.length >= LIMIT) return undefined
    chain.push(next)
    current = next.to
  }
  return chain
}
