/**
 * 导演稿的时间线：输出时间 ↔ 录制时间 ↔ 页面时间。
 *
 * - 录制时间：行为轨与数据轨上的时刻。
 * - 输出时间：版本视频里的时刻，第 i 帧在 i / fps 秒。
 * - 页面时间：重演页面里的时钟。平时与录制时间相同；打字机停住录制时间逐字输入时，页面时间照常往前走
 *   （过渡动画、光标都正常），之后的页面时间比录制时间多出打字用掉的时长。
 *
 * 时间线由几段组成，按输出时间先后：
 * - play：录制时间以速度 v 前进（v0 ≠ v1 时是平滑变速，速度随输出时间线性变化）；页面时间与录制时间同步前进。
 * - hold：录制时间停住，页面时间与输出时间同步前进（打字机）。
 * 剪掉的录制区间（cut）不占输出时间：页面在不出帧的情况下推过去。
 */

export interface TimelineSegmentUs { fromUs: number; toUs: number; speed: number }
export interface TimelineHold { recUs: number; durationUs: number; label: string }

export interface TimelinePiece {
  kind: 'play' | 'hold'
  outStartUs: number
  outEndUs: number
  recStartUs: number
  recEndUs: number
  /** 页面时间在这段开头的值。 */
  pageStartUs: number
  /** 起止速度（录制秒 / 输出秒）；hold 为 0。 */
  v0: number
  v1: number
  /** hold：哪一步停住的。 */
  label?: string
}
export interface TimelineCut { recFromUs: number; recToUs: number; pageFromUs: number; pageToUs: number; /** 剪掉的区间落在输出的哪一刻（前一段的结尾）。 */ outUs: number }

/** 录制时间落在输出的哪里：visible=false 时在剪掉的区间里（outUs 是接缝处）或在时间线结束之后（after）。 */
export interface RecPlacement { outUs: number; visible: boolean; after: boolean }

interface Span { piece?: TimelinePiece; cut?: TimelineCut }

const EPS = 1e-6

/** 平滑变速段内，输出时长 τ 时走过的录制时长。 */
function recCovered(v0: number, v1: number, durUs: number, tauUs: number): number {
  return durUs > 0 ? v0 * tauUs + (v1 - v0) * tauUs * tauUs / (2 * durUs) : 0
}
/** 平滑变速段内，走过录制时长 Δ 用掉的输出时长（数值稳定的求根式，匀速时退化为 Δ / v）。 */
function tauFor(v0: number, v1: number, durUs: number, deltaUs: number): number {
  if (deltaUs <= 0) return 0
  const a = durUs > 0 ? (v1 - v0) / (2 * durUs) : 0
  const disc = Math.max(0, v0 * v0 + 4 * a * deltaUs)
  return Math.min(durUs, (2 * deltaUs) / (v0 + Math.sqrt(disc)))
}

export class DirectorTimeline {
  readonly pieces: readonly TimelinePiece[]
  readonly cuts: readonly TimelineCut[]
  readonly durationUs: number
  readonly frames: number

  private constructor(private readonly spans: readonly Span[], readonly fps: number) {
    this.pieces = spans.flatMap(s => (s.piece ? [s.piece] : []))
    this.cuts = spans.flatMap(s => (s.cut ? [s.cut] : []))
    this.durationUs = this.pieces.at(-1)?.outEndUs ?? 0
    this.frames = Math.max(1, Math.ceil(this.durationUs * fps / 1e6 - EPS))
  }

  /**
   * segments 为空时整段录制 1 倍速。rampUs：相邻且首尾相接、速度不同的两段之间用多少输出时长平滑变速
   * （占前后两段各一半，录制总长与输出总长都不变）。holds：在这些录制时刻停住录制时间多少输出时长；
   * 落在剪掉的区间或时间线之外的 hold 不生效，放在 dropped 里。
   */
  static build(input: { totalRecUs: number; segments?: readonly TimelineSegmentUs[]; rampUs?: number; holds?: readonly TimelineHold[]; fps: number }): { timeline: DirectorTimeline; dropped: TimelineHold[] } {
    const total = Math.max(0, input.totalRecUs)
    const segments = (input.segments?.length ? input.segments : [{ fromUs: 0, toUs: total, speed: 1 }])
      .map(s => ({ fromUs: Math.max(0, Math.min(total, s.fromUs)), toUs: Math.max(0, Math.min(total, s.toUs)), speed: s.speed }))
      .filter(s => s.toUs > s.fromUs)
    if (!segments.length) throw new Error('时间线留下的区间都在录制之外')
    const rampUs = Math.max(0, input.rampUs ?? 0)

    // 相接的两段之间的变速过渡（输出时长），不相接（中间剪掉）的为 0
    const out = (s: { fromUs: number; toUs: number; speed: number }): number => (s.toUs - s.fromUs) / s.speed
    const ramps = segments.slice(0, -1).map((s, k) => {
      const next = segments[k + 1]
      if (rampUs <= 0 || s.toUs !== next.fromUs || s.speed === next.speed) return 0
      return Math.min(rampUs, out(s), out(next))
    })

    type Raw = { kind: 'play'; recStartUs: number; recEndUs: number; v0: number; v1: number; durUs: number } | { kind: 'cut'; recFromUs: number; recToUs: number }
    const raw: Raw[] = []
    if (segments[0].fromUs > 0) raw.push({ kind: 'cut', recFromUs: 0, recToUs: segments[0].fromUs })
    segments.forEach((s, k) => {
      const left = k > 0 ? ramps[k - 1] / 2 : 0
      const right = k < ramps.length ? ramps[k] / 2 : 0
      const start = s.fromUs + s.speed * left
      const end = s.toUs - s.speed * right
      if (end - start > EPS) raw.push({ kind: 'play', recStartUs: start, recEndUs: end, v0: s.speed, v1: s.speed, durUs: (end - start) / s.speed })
      if (k < ramps.length) {
        const next = segments[k + 1]
        if (ramps[k] > 0) raw.push({ kind: 'play', recStartUs: end, recEndUs: next.fromUs + next.speed * ramps[k] / 2, v0: s.speed, v1: next.speed, durUs: ramps[k] })
        else if (next.fromUs > s.toUs) raw.push({ kind: 'cut', recFromUs: s.toUs, recToUs: next.fromUs })
      }
    })

    // 打字机停住录制时间：插进覆盖该时刻的段落（必要时把段落一分为二）
    type Item = Raw | { kind: 'hold'; recUs: number; durUs: number; label: string }
    let items: Item[] = raw
    const dropped: TimelineHold[] = []
    for (const hold of [...(input.holds ?? [])].sort((a, b) => a.recUs - b.recUs)) {
      if (hold.durationUs <= 0) continue
      const index = items.findIndex(item => item.kind === 'play' && hold.recUs >= item.recStartUs - EPS && hold.recUs < item.recEndUs - EPS)
      // 落在最后一段的末尾也算（时间线最后停住打字）
      const last = items.at(-1)
      const atEnd = index < 0 && last?.kind === 'play' && Math.abs(hold.recUs - last.recEndUs) <= EPS
      if (index < 0 && !atEnd) { dropped.push(hold); continue }
      const entry: Item = { kind: 'hold', recUs: hold.recUs, durUs: hold.durationUs, label: hold.label }
      if (atEnd) { items = [...items, entry]; continue }
      const piece = items[index] as Extract<Raw, { kind: 'play' }>
      const tau = tauFor(piece.v0, piece.v1, piece.durUs, hold.recUs - piece.recStartUs)
      // 在段落开头：直接排在它前面（同一刻已有的 hold 在更前面，先后不变）
      if (tau <= EPS) { items = [...items.slice(0, index), entry, ...items.slice(index)]; continue }
      const vAt = piece.v0 + (piece.v1 - piece.v0) * tau / piece.durUs
      const head: Raw = { kind: 'play', recStartUs: piece.recStartUs, recEndUs: hold.recUs, v0: piece.v0, v1: vAt, durUs: tau }
      const tail: Raw = { kind: 'play', recStartUs: hold.recUs, recEndUs: piece.recEndUs, v0: vAt, v1: piece.v1, durUs: piece.durUs - tau }
      items = [...items.slice(0, index), head, entry, ...(tail.durUs > EPS ? [tail] : []), ...items.slice(index + 1)]
    }

    // 依次排出输出时间与页面时间
    const spans: Span[] = []
    let outUs = 0
    let offsetUs = 0 // 页面时间 − 录制时间
    for (const item of items) {
      if (item.kind === 'cut') { spans.push({ cut: { recFromUs: item.recFromUs, recToUs: item.recToUs, pageFromUs: item.recFromUs + offsetUs, pageToUs: item.recToUs + offsetUs, outUs } }); continue }
      if (item.kind === 'hold') {
        spans.push({ piece: { kind: 'hold', outStartUs: outUs, outEndUs: outUs + item.durUs, recStartUs: item.recUs, recEndUs: item.recUs, pageStartUs: item.recUs + offsetUs, v0: 0, v1: 0, label: item.label } })
        outUs += item.durUs
        offsetUs += item.durUs
        continue
      }
      spans.push({ piece: { kind: 'play', outStartUs: outUs, outEndUs: outUs + item.durUs, recStartUs: item.recStartUs, recEndUs: item.recEndUs, pageStartUs: item.recStartUs + offsetUs, v0: item.v0, v1: item.v1 } })
      outUs += item.durUs
    }
    return { timeline: new DirectorTimeline(spans, input.fps), dropped }
  }

  /** 第 i 帧的输出时间（µs，不取整）。 */
  frameOutUs(index: number): number { return index * 1e6 / this.fps }

  private pieceAtOut(outUs: number): TimelinePiece {
    const pieces = this.pieces
    let lo = 0, hi = pieces.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (pieces[mid].outStartUs <= outUs) lo = mid
      else hi = mid - 1
    }
    return pieces[lo]
  }

  /** 输出时刻对应的录制时间与页面时间；超出结尾时停在结尾。 */
  at(outUs: number): { recUs: number; pageUs: number } {
    const piece = this.pieceAtOut(Math.max(0, outUs))
    const tau = Math.max(0, Math.min(piece.outEndUs, outUs) - piece.outStartUs)
    if (piece.kind === 'hold') return { recUs: piece.recStartUs, pageUs: piece.pageStartUs + tau }
    const rec = Math.min(piece.recEndUs, piece.recStartUs + recCovered(piece.v0, piece.v1, piece.outEndUs - piece.outStartUs, tau))
    return { recUs: rec, pageUs: piece.pageStartUs + (rec - piece.recStartUs) }
  }

  /** 输出时刻的播放速度（录制秒 / 输出秒）；停住打字时为 0。 */
  speedAt(outUs: number): number {
    const piece = this.pieceAtOut(Math.max(0, outUs))
    if (piece.kind === 'hold') return 0
    const dur = piece.outEndUs - piece.outStartUs
    return dur > 0 ? piece.v0 + (piece.v1 - piece.v0) * Math.min(1, Math.max(0, (outUs - piece.outStartUs) / dur)) : piece.v0
  }

  /**
   * 录制时刻在输出里的位置：在留下的区间里时是第一次显示它的输出时刻（停住打字的同一刻排在打字之前）；
   * 在剪掉的区间里时 visible=false、outUs 是接缝；在时间线之后时 after=true。
   */
  placeRec(recUs: number): RecPlacement {
    for (const span of this.spans) {
      if (span.cut) {
        if (recUs >= span.cut.recFromUs && recUs < span.cut.recToUs) return { outUs: span.cut.outUs, visible: false, after: false }
        continue
      }
      const piece = span.piece!
      if (piece.kind !== 'play' || recUs < piece.recStartUs - EPS || recUs > piece.recEndUs + EPS) continue
      const dur = piece.outEndUs - piece.outStartUs
      return { outUs: piece.outStartUs + tauFor(piece.v0, piece.v1, dur, recUs - piece.recStartUs), visible: true, after: false }
    }
    return { outUs: this.durationUs, visible: false, after: true }
  }

  /**
   * 页面时刻在输出里的位置：在留下的区间或停住打字里时是显示它的输出时刻；在剪掉的区间里时 visible=false、
   * outUs 是接缝；在时间线之后时 after=true。与 placeRec 一致：两段留下的部分相接的那一刻算前一段；
   * 剪掉的区间与后面一段相接的那一刻（剪掉区间的终点）算后面那段，visible=true。
   */
  placePage(pageUs: number): RecPlacement {
    for (const span of this.spans) {
      if (span.cut) {
        if (pageUs < span.cut.pageToUs) return { outUs: span.cut.outUs, visible: false, after: false }
        continue
      }
      const piece = span.piece!
      const pageSpan = piece.kind === 'hold' ? piece.outEndUs - piece.outStartUs : piece.recEndUs - piece.recStartUs
      if (pageUs > piece.pageStartUs + pageSpan + EPS) continue
      const offset = Math.max(0, pageUs - piece.pageStartUs)
      const outOffset = piece.kind === 'hold' ? offset : tauFor(piece.v0, piece.v1, piece.outEndUs - piece.outStartUs, offset)
      return { outUs: piece.outStartUs + outOffset, visible: true, after: false }
    }
    return { outUs: this.durationUs, visible: false, after: true }
  }

  /** 录制时刻的页面时间（同一刻停住的打字不算在内：事件排在打字之前）。 */
  pageOfRec(recUs: number): number {
    let offset = 0
    for (const piece of this.pieces) if (piece.kind === 'hold' && piece.recStartUs < recUs - EPS) offset += piece.outEndUs - piece.outStartUs
    return recUs + offset
  }

  /** 页面时刻对应的录制时间（停住打字期间是停住的那一刻）。 */
  recOfPage(pageUs: number): number {
    let rec = pageUs
    for (const span of this.spans) {
      if (span.cut) {
        if (pageUs < span.cut.pageFromUs) break
        rec = span.cut.recFromUs + (pageUs - span.cut.pageFromUs)
        continue
      }
      const piece = span.piece!
      if (pageUs < piece.pageStartUs) break
      rec = piece.kind === 'hold' ? piece.recStartUs : piece.recStartUs + (pageUs - piece.pageStartUs)
      if (piece.kind === 'hold' && pageUs <= piece.pageStartUs + (piece.outEndUs - piece.outStartUs)) return rec
    }
    return rec
  }

  /** 写进版本的时间对照（timemap.json）。 */
  toFile(frameRecUs: readonly number[]): WebReplayTimeMapFile {
    const round = (value: number): number => Math.round(value)
    return {
      version: 1, fps: this.fps, durationUs: round(this.durationUs), frames: this.frames,
      pieces: this.pieces.map(p => ({ kind: p.kind, outUs: [round(p.outStartUs), round(p.outEndUs)], recUs: [round(p.recStartUs), round(p.recEndUs)], speed: [p.v0, p.v1], ...(p.label ? { step: p.label } : {}) })),
      cuts: this.cuts.map(c => ({ recUs: [round(c.recFromUs), round(c.recToUs)], outUs: round(c.outUs) })),
      frameRecUs: frameRecUs.map(round),
    }
  }
}

export interface WebReplayTimeMapFile {
  version: 1
  fps: number
  durationUs: number
  frames: number
  pieces: Array<{ kind: 'play' | 'hold'; outUs: [number, number]; recUs: [number, number]; speed: [number, number]; step?: string }>
  cuts: Array<{ recUs: [number, number]; outUs: number }>
  /** 第 i 帧显示的录制时间（µs）。 */
  frameRecUs: number[]
}
