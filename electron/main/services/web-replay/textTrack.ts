import crypto from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { replaceFileAtomically } from '../fs/atomic-file'

/**
 * 网页录制的文字轨：重演时定时记下画面上看得见的文字与位置（CSS 像素），写在录制文件夹里。
 * 剪辑时按文字直接搜出“哪一刻、画面哪个位置出现了什么字”，不必逐帧看录屏；位置按画面比例给，
 * 与重演视频的画面一一对应（重演视频就是整个视口）。
 */
export const TEXT_TRACK_FILE = 'text.jsonl'
/** 页面时间每隔这么久取一次。 */
export const TEXT_SAMPLE_INTERVAL_US = 200_000

/** 在重演页面里执行：可见的文本节点，各自的边框（相对视口）。 */
export const TEXT_SAMPLE_SCRIPT = `(() => {
  const out = [], vw = innerWidth, vh = innerHeight, range = document.createRange()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const hidden = new Map()
  const invisible = el => {
    if (hidden.has(el)) return hidden.get(el)
    const style = getComputedStyle(el)
    const value = style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.05 || (el.parentElement ? invisible(el.parentElement) : false)
    hidden.set(el, value); return value
  }
  for (let node = walker.nextNode(); node && out.length < 4000; node = walker.nextNode()) {
    const text = node.nodeValue.replace(/\\s+/g, ' ').trim()
    if (!text || !node.parentElement || invisible(node.parentElement)) continue
    range.selectNodeContents(node)
    const r = range.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue
    out.push([text, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)])
  }
  for (const el of document.querySelectorAll('input, textarea')) {
    const value = (el.value || '').replace(/\\s+/g, ' ').trim()
    if (!value || invisible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width >= 1 && r.height >= 1) out.push([value, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)])
  }
  return { width: vw, height: vh, items: out }
})()`

export type TextItem = [text: string, x: number, y: number, width: number, height: number]
export interface TextSample { width: number; height: number; items: TextItem[] }
type TextLine = { t: number; width: number; height: number; items: TextItem[] }

/**
 * 只在画面文字有变化时写一行；结束时补一行空白，标出最后一段的结束时间。
 * 暂存后原子发布：失败、取消或判定错位时不覆盖上一次完整的文字轨。
 */
export class TextTrackWriter {
  private readonly staged: string
  private readonly stream: WriteStream
  private failure: Error | null = null
  private previous = ''
  private lastT = 0
  constructor(readonly file: string) {
    this.staged = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`)
    this.stream = createWriteStream(this.staged, { encoding: 'utf8', flags: 'wx' })
    this.stream.on('error', error => { this.failure ??= error })
  }
  write(t: number, sample: TextSample): void {
    this.lastT = t
    const key = JSON.stringify([sample.width, sample.height, sample.items])
    if (key === this.previous) return
    this.previous = key
    this.stream.write(`${JSON.stringify({ t, width: sample.width, height: sample.height, items: sample.items } satisfies TextLine)}\n`)
  }
  async close(endT = this.lastT): Promise<void> {
    this.stream.write(`${JSON.stringify({ t: endT, width: 0, height: 0, items: [] } satisfies TextLine)}\n`)
    await new Promise<void>((resolve, reject) => this.stream.end((error?: Error | null) => error ? reject(error) : resolve()))
    if (this.failure) throw this.failure
    await replaceFileAtomically(this.staged, this.file)
  }
  async abort(): Promise<void> {
    if (!this.stream.closed) await new Promise<void>(resolve => { this.stream.once('close', () => resolve()); this.stream.destroy() })
    await fs.rm(this.staged, { force: true })
  }
}

export interface TextAppearance {
  text: string
  /** 出现与消失的录制时间（秒）。 */
  fromSeconds: number
  toSeconds: number
  /** 在画面里的位置，按画面宽高的比例（0–1，左上为原点）。 */
  rect: { x: number; y: number; width: number; height: number }
}

async function readLines(directory: string): Promise<TextLine[]> {
  const text = await fs.readFile(path.join(directory, TEXT_TRACK_FILE), 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('这段录制还没有文字轨：先用 render_web_app_replay（textOnly=true）重演一遍，通常比录制本身快得多')
    throw error
  })
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line) as TextLine)
}

/**
 * 按文字搜（不分大小写，空白归一）：同一段文字停在同一位置算一次出现，给出出现到消失的时间与位置。
 * 位置变了（滚动、展开）算新的一次出现。
 */
export async function searchTextTrack(directory: string, query: string, limit: number): Promise<{ matches: TextAppearance[]; total: number }> {
  const lines = await readLines(directory)
  const needle = query.replace(/\s+/g, ' ').trim().toLowerCase()
  const open = new Map<string, TextAppearance>()
  const done: TextAppearance[] = []
  for (const line of lines) {
    const seconds = line.t / 1e6
    const present = new Set<string>()
    for (const [text, x, y, width, height] of line.items) {
      if (!text.toLowerCase().includes(needle)) continue
      const key = JSON.stringify([text, x, y, width, height])
      present.add(key)
      if (!open.has(key)) open.set(key, { text, fromSeconds: seconds, toSeconds: seconds, rect: { x: x / line.width, y: y / line.height, width: width / line.width, height: height / line.height } })
    }
    for (const [key, appearance] of open) if (!present.has(key)) { appearance.toSeconds = seconds; done.push(appearance); open.delete(key) }
  }
  const last = lines.at(-1)?.t ?? 0
  for (const appearance of open.values()) { appearance.toSeconds = last / 1e6; done.push(appearance) }
  done.sort((a, b) => a.fromSeconds - b.fromSeconds || a.rect.y - b.rect.y)
  return { matches: done.slice(0, limit), total: done.length }
}

/** 不给关键词时分页读快照：某一刻画面上的全部文字。 */
export async function readTextTrack(directory: string, offset: number, limit: number): Promise<{ entries: unknown[]; total: number }> {
  const lines = (await readLines(directory)).filter(line => line.items.length)
  return { entries: lines.slice(offset, offset + limit).map(line => ({ seconds: line.t / 1e6, width: line.width, height: line.height, items: line.items })), total: lines.length }
}
