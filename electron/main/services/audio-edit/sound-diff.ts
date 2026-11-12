import { z } from 'zod'
import type { AudioEditGainRegion } from '../../../../src/core/audioEdit/regions'

/*
 * 两版“编辑后声音”（时间轴同原素材）哪些帧可能不同。
 *
 * 一版声音描述成按处理顺序的一串操作；每种操作声明它改写哪些帧、改写结果依赖哪些帧：
 * - local：只改写区间 write，write 内的结果只取决于 write 两侧各 context 帧以内的声音，write 外原样复制（频谱修复、去爆音）；
 * - clicks：口水音多段插值，每段只改写自身，结果取决于两侧各 margin 帧以内的声音与这一范围内其他段的位置；
 * - gain：逐样本乘音量区域，结果只取决于这一帧被哪些区域、按什么顺序覆盖（呼吸、区间音量）；
 * - global：整段处理（实时效果整段跑、人声分离、插件……），任何上游差异或自身参数变化都让整段失效。
 * 新旧两版的操作按匹配键对齐，顺序走一遍维护“可能不同的帧”。拿不准的情况一律返回整段（带原因），调用方整段重算。
 */

export type AudioEditFrameRange = [start: number, end: number]
/** 区域按处理顺序：[起点, 终点, 音量 dB, 淡入帧数, 淡出帧数]。 */
export type AudioEditGainRecipe = [number, number, number, number, number]

export type AudioEditSoundOp =
  | { key: string; kind: 'local'; recipe: string; write: AudioEditFrameRange; context: number }
  | { key: string; kind: 'clicks'; ranges: AudioEditFrameRange[]; margin: number }
  | { key: string; kind: 'gain'; regions: AudioEditGainRecipe[] }
  | { key: string; kind: 'global'; recipe: string }

export interface AudioEditSoundDescription {
  /** 素材身份、声音流、采样率、声道、帧数：任何一项不同都整段不同。 */
  source: string
  frames: number
  ops: AudioEditSoundOp[]
}

export type AudioEditSoundDiff = { ranges: AudioEditFrameRange[] } | { all: string }

/** 落盘的操作序列（上一版编辑后声音的记录）先按这个结构校验，读不懂的一律当没有可比的上一版。 */
const frame = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const frameRange = z.tuple([frame, frame]).refine(([start, end]) => end > start)
const opKey = z.string().min(1)
export const audioEditSoundDescriptionSchema = z.object({
  source: z.string().min(1),
  frames: frame,
  ops: z.array(z.discriminatedUnion('kind', [
    z.object({ key: opKey, kind: z.literal('local'), recipe: z.string().min(1), write: frameRange, context: frame }).strict(),
    z.object({ key: opKey, kind: z.literal('clicks'), ranges: z.array(frameRange), margin: frame }).strict(),
    z.object({ key: opKey, kind: z.literal('gain'), regions: z.array(z.tuple([frame, frame, z.number().finite(), frame, frame]).refine(([start, end]) => end > start)) }).strict(),
    z.object({ key: opKey, kind: z.literal('global'), recipe: z.string() }).strict(),
  ])),
}).strict()

/** 区域按处理顺序（按起点稳定排序，与整段乘音量的工作线程一致）。 */
export function audioEditGainLayer(regions: readonly AudioEditGainRegion[]): AudioEditGainRegion[] {
  return regions.filter(region => region.enabled).sort((a, b) => a.startFrame - b.startFrame)
}
export function audioEditGainRecipes(layer: readonly AudioEditGainRegion[]): AudioEditGainRecipe[] {
  return layer.map(region => [region.startFrame, region.endFrame, region.gainDb, region.fadeInFrames, region.fadeOutFrames])
}

/** 对齐表的格数上限：两版中段都有上千个不同的操作时直接按整段处理，不逐个比较。 */
const MAX_ALIGNMENT_CELLS = 4_000_000

class FrameSet {
  private ranges: AudioEditFrameRange[] = []
  private normalized = true
  add(start: number, end: number): void {
    if (end <= start) return
    this.ranges.push([start, end]); this.normalized = false
  }
  addAll(ranges: readonly AudioEditFrameRange[]): void { for (const [start, end] of ranges) this.add(start, end) }
  get empty(): boolean { return this.ranges.length === 0 }
  list(): AudioEditFrameRange[] {
    if (!this.normalized) {
      const sorted = this.ranges.sort((a, b) => a[0] - b[0])
      const merged: AudioEditFrameRange[] = []
      for (const [start, end] of sorted) {
        const last = merged.at(-1)
        if (last && start <= last[1]) last[1] = Math.max(last[1], end)
        else merged.push([start, end])
      }
      this.ranges = merged; this.normalized = true
    }
    return this.ranges
  }
  intersects(start: number, end: number): boolean {
    const ranges = this.list()
    let low = 0, high = ranges.length
    // 第一个终点大于 start 的区间
    while (low < high) { const middle = (low + high) >> 1; if (ranges[middle][1] <= start) low = middle + 1; else high = middle }
    return low < ranges.length && ranges[low][0] < end
  }
}

const sameRange = (a: AudioEditFrameRange, b: AudioEditFrameRange): boolean => a[0] === b[0] && a[1] === b[1]
const sameRecipe = (a: AudioEditGainRecipe, b: AudioEditGainRecipe): boolean => a.every((value, index) => value === b[index])

/** 两层音量区域在哪些帧上“覆盖这一帧的区域序列”不同（每帧的乘法序列相同，结果就逐样本相同）。 */
export function audioEditGainDiff(before: readonly AudioEditGainRecipe[], after: readonly AudioEditGainRecipe[]): AudioEditFrameRange[] {
  if (before.length === after.length && before.every((region, index) => sameRecipe(region, after[index]))) return []
  const points = [...new Set([...before, ...after].flatMap(region => [region[0], region[1]]))].sort((a, b) => a - b)
  const cursor = { before: 0, after: 0 }
  const active = { before: [] as AudioEditGainRecipe[], after: [] as AudioEditGainRecipe[] }
  const dirty = new FrameSet()
  for (let index = 0; index + 1 < points.length; index++) {
    const point = points[index]
    for (const side of ['before', 'after'] as const) {
      const regions = side === 'before' ? before : after
      // 区域已按起点排序：同一边新加入的区域总排在已覆盖的区域之后，保持处理顺序。
      active[side] = active[side].filter(region => region[1] > point)
      while (cursor[side] < regions.length && regions[cursor[side]][0] <= point) {
        const region = regions[cursor[side]++]
        if (region[1] > point) active[side].push(region)
      }
    }
    const a = active.before, b = active.after
    if (a.length !== b.length || a.some((region, at) => !sameRecipe(region, b[at]))) dirty.add(point, points[index + 1])
  }
  return dirty.list()
}

/** 最长公共子序列对齐：返回按处理顺序的配对，未匹配的一侧为 undefined。 */
function align(before: readonly AudioEditSoundOp[], after: readonly AudioEditSoundOp[]): Array<[AudioEditSoundOp | undefined, AudioEditSoundOp | undefined]> | undefined {
  let head = 0
  while (head < before.length && head < after.length && before[head].key === after[head].key) head++
  let tail = 0
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail].key === after[after.length - 1 - tail].key) tail++
  const a = before.slice(head, before.length - tail), b = after.slice(head, after.length - tail)
  if ((a.length + 1) * (b.length + 1) > MAX_ALIGNMENT_CELLS) return undefined
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i * width + j] = a[i].key === b[j].key ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
  }
  const middle: Array<[AudioEditSoundOp | undefined, AudioEditSoundOp | undefined]> = []
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].key === b[j].key) { middle.push([a[i++], b[j++]]); continue }
    if (j >= b.length || (i < a.length && table[(i + 1) * width + j] >= table[i * width + j + 1])) middle.push([a[i++], undefined])
    else middle.push([undefined, b[j++]])
  }
  return [
    ...before.slice(0, head).map((op, index) => [op, after[index]] as [AudioEditSoundOp, AudioEditSoundOp]),
    ...middle,
    ...before.slice(before.length - tail).map((op, index) => [op, after[after.length - tail + index]] as [AudioEditSoundOp, AudioEditSoundOp]),
  ]
}

/** 只出现在一版里的操作：它改写过的帧都算不同。认不出的操作返回整段的原因。 */
function unmatched(op: AudioEditSoundOp, dirty: FrameSet): string | undefined {
  switch (op.kind) {
    case 'local': dirty.add(op.write[0], op.write[1]); return undefined
    case 'clicks': dirty.addAll(op.ranges); return undefined
    case 'gain': for (const region of op.regions) dirty.add(region[0], region[1]); return undefined
    case 'global': return `整段处理的效果增删（${op.key}）`
    default: return `认不出的处理（${String((op as { kind?: unknown }).kind)}）`
  }
}

/** 素材的一次补录拼接：[start, end) 换成 inserted 帧新录音。 */
export interface AudioEditSoundSplice { start: number; end: number; inserted: number }

/**
 * 把一版声音的操作序列映射到素材补录拼接后的坐标。拼接点之前的帧原样；被替换段之后的帧平移 inserted - (end - start)。
 * 操作的作用范围（连同它依赖的上下文）完全在拼接点之前、或在被替换段之后且平移量为 0 时原样保留；
 * 增益区与口水音段在被替换段之后时随帧平移（逐样本运算与位置无关）；其余（跨过拼接点、修复在平移段里）不能映射，从序列里拿掉，
 * 它们在新坐标里能落到的帧连同插入段一起作为“来源处就不同的帧”返回，比较时当作上游改动。
 * 整段处理的操作原样保留：上游有任何改动它就整段不同，由比较处判断。
 */
export function mapAudioEditSoundThroughSplice(sound: AudioEditSoundDescription, splice: AudioEditSoundSplice, next: { source: string; frames: number }): { sound: AudioEditSoundDescription; dirty: AudioEditFrameRange[] } {
  const { start, end, inserted } = splice
  const delta = inserted - (end - start)
  const dirty = new FrameSet()
  dirty.add(start, start + inserted)
  /**
   * 一段旧区间（连同两侧 context 帧的依赖）在新坐标里的位置：完全在拼接点之前原样，完全在被替换段之后平移；
   * 跨过被替换段时返回 undefined，并把它能落到新坐标里的两截记为不同。半开区间：止于拼接点的算之前，起于被替换段终点的算之后。
   */
  const map = (range: AudioEditFrameRange, context = 0): AudioEditFrameRange | undefined => {
    if (range[1] + context <= start) return range
    if (range[0] - context >= end) return [range[0] + delta, range[1] + delta]
    if (range[0] < start) dirty.add(range[0], Math.min(range[1], start))
    if (range[1] > end) dirty.add(Math.max(range[0], end) + delta, range[1] + delta)
    return undefined
  }
  const ops: AudioEditSoundOp[] = []
  for (const op of sound.ops) {
    if (op.kind === 'global') { ops.push(op); continue }
    if (op.kind === 'local') {
      const mapped = map(op.write, op.context)
      // 修复的配方里带着它的位置，平移后就是另一个配方：平移量不为 0 时在新坐标里按改写过的帧算不同。
      if (mapped && (mapped === op.write || delta === 0)) ops.push(op)
      else if (mapped) dirty.add(mapped[0], mapped[1])
      continue
    }
    if (op.kind === 'clicks') {
      const ranges = op.ranges.flatMap(range => { const mapped = map(range, op.margin); return mapped ? [mapped] : [] })
      ops.push({ ...op, ranges })
      continue
    }
    const regions = op.regions.flatMap(region => {
      const mapped = map([region[0], region[1]])
      return mapped ? [[mapped[0], mapped[1], region[2], region[3], region[4]] as AudioEditGainRecipe] : []
    })
    ops.push({ ...op, regions })
  }
  return { sound: { source: next.source, frames: next.frames, ops }, dirty: dirty.list().map(([from, to]) => [Math.max(0, from), Math.min(next.frames, to)] as AudioEditFrameRange).filter(([from, to]) => to > from) }
}

/** 一组帧区间映射到补录拼接后的坐标：拼接点之前原样，被替换段之后平移，落进被替换段的部分并入插入段（插入段本身另算不同）。 */
export function mapAudioEditFramesThroughSplice(ranges: readonly AudioEditFrameRange[], splice: AudioEditSoundSplice): AudioEditFrameRange[] {
  const { start, end, inserted } = splice
  const delta = inserted - (end - start)
  return ranges.flatMap(([from, to]) => [
    ...(from < start ? [[from, Math.min(to, start)] as AudioEditFrameRange] : []),
    ...(to > end ? [[Math.max(from, end) + delta, to + delta] as AudioEditFrameRange] : []),
    ...(from < end && to > start ? [[start, start + inserted] as AudioEditFrameRange] : []),
  ])
}

/** seed：来源处就不同的帧（补录拼接的插入段等），当作所有操作的上游改动。 */
export function diffAudioEditSound(before: AudioEditSoundDescription, after: AudioEditSoundDescription, seed: readonly AudioEditFrameRange[] = []): AudioEditSoundDiff {
  if (before.source !== after.source || before.frames !== after.frames) return { all: '素材或声音规格不同' }
  const pairs = align(before.ops, after.ops)
  if (!pairs) return { all: '前后两版改动的操作太多' }
  const dirty = new FrameSet()
  dirty.addAll(seed)
  for (const [old, next] of pairs) {
    if (!old || !next) {
      const reason = unmatched((old ?? next)!, dirty)
      if (reason) return { all: reason }
      continue
    }
    if (old.kind !== next.kind) return { all: `同一项的处理方式变了（${next.key}）` }
    if (old.kind === 'global' && next.kind === 'global') {
      if (old.recipe !== next.recipe) return { all: `整段处理的效果参数变了（${next.key}）` }
      if (!dirty.empty) return { all: `整段处理的效果上游有改动（${next.key}）` }
    } else if (old.kind === 'local' && next.kind === 'local') {
      // 上下文取两版里较宽的一个：记录可能是取样范围不同的程序写下的。
      const context = Math.max(old.context, next.context)
      if (old.recipe !== next.recipe || !sameRange(old.write, next.write)) { dirty.add(old.write[0], old.write[1]); dirty.add(next.write[0], next.write[1]) }
      else if (dirty.intersects(next.write[0] - context, next.write[1] + context)) dirty.add(next.write[0], next.write[1])
    } else if (old.kind === 'gain' && next.kind === 'gain') {
      dirty.addAll(audioEditGainDiff(old.regions, next.regions))
    } else if (old.kind === 'clicks' && next.kind === 'clicks') {
      const margin = Math.max(old.margin, next.margin)
      const name = (range: AudioEditFrameRange): string => `${range[0]}:${range[1]}`
      const oldNames = new Set(old.ranges.map(name)), nextNames = new Set(next.ranges.map(name))
      const changed = [...old.ranges.filter(range => !nextNames.has(name(range))), ...next.ranges.filter(range => !oldNames.has(name(range)))]
      const touched = new FrameSet()
      touched.addAll(dirty.list()); touched.addAll(changed)
      // 两版都有的段：两侧取样窗里声音或相邻段位置变了，插值结果才会变。
      for (const range of next.ranges) {
        if (oldNames.has(name(range)) && touched.intersects(range[0] - margin, range[1] + margin)) dirty.add(range[0], range[1])
      }
      dirty.addAll(changed)
    } else return { all: `认不出的处理（${next.key}）` }
  }
  return { ranges: dirty.list().map(([start, end]) => [Math.max(0, start), Math.min(after.frames, end)] as AudioEditFrameRange).filter(([start, end]) => end > start) }
}

export function audioEditFrameCount(ranges: readonly AudioEditFrameRange[]): number {
  return ranges.reduce((sum, [start, end]) => sum + end - start, 0)
}
