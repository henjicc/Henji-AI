import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import { boxTrackQuerySchema, type BoxTrackQuery } from '../../../../src/core/webReplay/boxTrackQuery'
import { createMainLogger } from '../logging'
import { BOX_TRACK_FILE } from './boxTrack'

const logger = createMainLogger('main.web_replay.boxes')
const finite = z.number().finite()
const lineSchema = z.object({
  t: finite.int().nonnegative().max(Number.MAX_SAFE_INTEGER), width: finite.nonnegative(), height: finite.nonnegative(),
  items: z.array(z.tuple([z.string(), finite, finite, finite.positive(), finite.positive()])),
}).strict().refine(line => !line.items.length || (line.width > 0 && line.height > 0))
const pageSchema = z.object({ offset: z.number().int().nonnegative(), limit: z.number().int().min(1) })

export interface BoxTrackEntry {
  key: string
  seconds: number
  /** 与文字轨相同的视口比例；部分出视口的边框裁切到 0–1。null 表示消失。 */
  rect: { x: number; y: number; width: number; height: number } | null
}
export interface BoxTrackPage { entries: BoxTrackEntry[]; total: number; nextOffset: number | null }
type Rect = NonNullable<BoxTrackEntry['rect']>

/** 流式扫描：内存只保留上一屏选中元素与当前页，不装载整条高频轨。 */
export async function readBoxTrack(directory: string, query: BoxTrackQuery, offset: number, limit: number): Promise<BoxTrackPage> {
  const filter = boxTrackQuerySchema.parse(query)
  pageSchema.parse({ offset, limit })
  const from = filter.fromSeconds ?? 0, to = filter.toSeconds ?? Infinity
  logger.info('开始读取界面元素位置轨', { event: 'web_replay.boxes.read_start', context: { offset, limit, fromSeconds: from, toSeconds: filter.toSeconds } })
  const stream = createReadStream(path.join(directory, BOX_TRACK_FILE), { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let previous = new Map<string, Rect>(), started = false, lastT = -1, lineNumber = 0, total = 0
  const entries: BoxTrackEntry[] = []
  const emit = (key: string, seconds: number, rect: Rect | null): void => {
    if (total >= offset && entries.length < limit) entries.push({ key, seconds, rect })
    total++
  }
  const baseline = (): void => { for (const [key, rect] of previous) emit(key, from, rect) }
  try {
    for await (const raw of lines) {
      lineNumber++
      if (!raw.trim()) continue
      const line = lineSchema.parse(JSON.parse(raw))
      if (line.t < lastT) throw new Error('录制时间未按顺序排列')
      lastT = line.t
      const seconds = line.t / 1e6
      if (!started && seconds > from) { baseline(); started = true }
      if (seconds > to) break
      const current = new Map<string, Rect>()
      for (const [key, x, y, width, height] of line.items) {
        if (filter.key !== undefined && key !== filter.key || filter.keyPrefix !== undefined && !key.startsWith(filter.keyPrefix)) continue
        if (current.has(key)) throw new Error('元素键重复')
        const left = Math.max(0, Math.min(line.width, x)), top = Math.max(0, Math.min(line.height, y))
        const right = Math.max(left, Math.min(line.width, x + width)), bottom = Math.max(top, Math.min(line.height, y + height))
        current.set(key, { x: left / line.width, y: top / line.height, width: (right - left) / line.width, height: (bottom - top) / line.height })
      }
      if (seconds >= from) {
        for (const [key, rect] of current) {
          const old = previous.get(key)
          if (!started || !old || rect.x !== old.x || rect.y !== old.y || rect.width !== old.width || rect.height !== old.height) emit(key, seconds, rect)
        }
        if (started) for (const key of previous.keys()) if (!current.has(key)) emit(key, seconds, null)
        started = true
      }
      previous = current
    }
    const result = { entries, total, nextOffset: offset + entries.length < total ? offset + entries.length : null }
    logger.info('界面元素位置轨读取完成', { event: 'web_replay.boxes.read_completed', context: { entries: entries.length, total } })
    return result
  } catch (error) {
    logger.error('界面元素位置轨读取失败', { event: 'web_replay.boxes.read_failed', context: { lineNumber }, error: String(error) })
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('这段录制还没有 boxes 位置轨：先用 render_web_app_replay 重演一遍（可 textOnly=true）')
    if (error instanceof SyntaxError || error instanceof z.ZodError) throw new Error(`boxes 位置轨第 ${lineNumber} 行无法读取：请用 render_web_app_replay（可 textOnly=true）重新生成`)
    throw error
  } finally { lines.close(); stream.destroy() }
}
