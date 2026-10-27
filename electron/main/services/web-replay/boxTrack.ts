import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { boxSelectorsSchema } from '../../../../src/core/webReplay/boxTrackQuery'
import { replaceFileAtomically } from '../fs/atomic-file'

export const BOX_TRACK_FILE = 'boxes.jsonl'
export type BoxItem = [key: string, x: number, y: number, width: number, height: number]
export interface BoxSample { width: number; height: number; items: BoxItem[] }
export interface BoxLine extends BoxSample { t: number }

/** 与播放器输出帧时钟一致；实时档减少一半跨进程采样。 */
export function boxSampleEveryFrames(timeScale: number): number { return timeScale >= 2 ? 1 : 2 }

/** 只查询目标元素，不扫描文字。序号从 0 开始，计入隐藏元素，避免显隐导致键漂移。 */
export function boxSampleScript(selectors: readonly string[] = []): string {
  const parsed = boxSelectorsSchema.safeParse(selectors)
  if (!parsed.success) throw new Error('boxSelectors 最多 32 个非空 CSS 选择器，每个不超过 1000 字符')
  return `(() => {
    const selectors = ${JSON.stringify(parsed.data)}, targets = new Map(), acts = new Map()
    for (const el of document.querySelectorAll('[data-replay-id], [data-act]')) {
      const act = el.getAttribute('data-act'), index = acts.get(act) || 0
      if (act !== null) acts.set(act, index + 1)
      targets.set(el, el.getAttribute('data-replay-id') || 'act:' + act + '#' + index)
    }
    for (const selector of selectors) {
      let elements
      try { elements = document.querySelectorAll(selector) }
      catch { throw new Error('boxSelectors 中的 CSS 选择器无效：' + selector) }
      elements.forEach((el, index) => { if (!targets.has(el)) targets.set(el, selector + '#' + index) })
    }
    const vw = innerWidth, vh = innerHeight, items = [], hidden = new Map(), styles = new Map(), keys = new Set()
    const styleOf = el => {
      if (!styles.has(el)) styles.set(el, getComputedStyle(el))
      return styles.get(el)
    }
    const invisible = el => {
      if (hidden.has(el)) return hidden.get(el)
      const style = styleOf(el)
      const value = style.display === 'none' || Number(style.opacity) === 0 || (el.parentElement ? invisible(el.parentElement) : false)
      hidden.set(el, value)
      return value
    }
    for (const [el, key] of targets) {
      if (keys.has(key)) throw new Error('界面元素位置轨的键重复：' + key + '；请为元素设置唯一 data-replay-id')
      keys.add(key)
      const style = styleOf(el)
      if (style.visibility === 'hidden' || style.visibility === 'collapse' || invisible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue
      items.push([key, r.left, r.top, r.width, r.height])
    }
    return { width: vw, height: vh, items }
  })()`
}

/** 只写变化与空白收尾。暂存后原子发布，失败或取消不覆盖上一次完整轨。 */
export class BoxTrackWriter {
  private readonly staged: string
  private handle?: fs.FileHandle
  private previous = ''
  private lastT = 0
  constructor(readonly file: string) { this.staged = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`) }

  private async append(line: BoxLine): Promise<void> {
    this.handle ??= await fs.open(this.staged, 'wx', 0o600)
    await this.handle.writeFile(`${JSON.stringify(line)}\n`)
  }

  async write(t: number, sample: BoxSample): Promise<void> {
    this.lastT = t
    const key = JSON.stringify(sample)
    if (key === this.previous) return
    await this.append({ t, ...sample })
    this.previous = key
  }

  async close(endT = this.lastT): Promise<void> {
    await this.append({ t: endT, width: 0, height: 0, items: [] })
    await this.handle?.sync()
    await this.handle?.close()
    this.handle = undefined
    await replaceFileAtomically(this.staged, this.file)
  }

  async abort(): Promise<void> {
    try { await this.handle?.close() } finally {
      this.handle = undefined
      await fs.rm(this.staged, { force: true })
    }
  }
}
