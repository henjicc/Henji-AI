import { MUSIC_TIMBRE_DIMS, type MusicAnalysis } from './musicAnalysis'

/*
 * 音频重构路径（Wenner 等 2013《Scalable Music: Automatic Music Retargeting and Synthesis》的拍级图思路）：
 * 拍为节点，顺序播放代价为 0；跳转只发生在小节位置相同、前后各几拍都相似的两拍之间。
 * 动态规划按“已播放拍数”逐层推进，求从第一拍走到最后一拍（首尾锚定前奏与尾奏）、拍数恰好为 k 的最低代价路径，
 * 取总时长不短于目标的最小 k；多出的不足一小节由版面在尾奏末尾截掉并淡出，最终时长精确到帧。
 *
 * - 重复程度：回跳形成的循环越短惩罚越大，惩罚权重随重复程度降低而升高（结果单调）。
 * - 切分粒度：beat 任意拍可跳、两次跳转至少隔 2 拍；bar 只在小节线跳、至少隔 1 小节；
 *   phrase 只在乐句起点（段落内每 4 小节）跳、至少隔 4 小节。
 */

export type MusicRemixGranularity = 'beat' | 'bar' | 'phrase'
export const MUSIC_REMIX_GRANULARITIES: readonly MusicRemixGranularity[] = ['beat', 'bar', 'phrase']

export interface MusicRemixRequest {
  analysis: MusicAnalysis
  /** 参与重构的源范围（秒），通常是片段当前的入点与出点。 */
  sourceStartSeconds: number
  sourceEndSeconds: number
  targetSeconds: number
  /** 0 尽量少重复同一小段（循环取长），1 允许短循环反复出现。 */
  repetition: number
  granularity: MusicRemixGranularity
  /** 0 为确定的最佳结果；其他值在代价上加入可复现的微小扰动，得到不同的变体。 */
  seed: number
  /** 时长余量：结果至少比目标长这么多秒，留给版面按帧截尾。 */
  marginSeconds?: number
}

export interface MusicRemixSegment {
  /** 源区间 [start, end)（秒）。 */
  sourceStartSeconds: number
  sourceEndSeconds: number
  /** 这一段第一拍（首段为源起点）在结果中的理想时刻（秒，相对结果起点）。 */
  timelineSeconds: number
  /** 首拍与末拍的分析拍下标（含）。 */
  firstBeat: number
  lastBeat: number
  /** 响度对齐增益（dB），首段为 0。 */
  gainDb: number
}

export interface MusicRemixSeam {
  /** 接缝处“下一拍”在结果中的理想时刻（秒）。 */
  timelineSeconds: number
  /** 跳出前最后播放的拍、跳入的拍（分析拍下标）。 */
  fromBeat: number
  toBeat: number
  /** 0–1，越高越不易听出接缝。 */
  confidence: number
  kind: 'repeat' | 'skip'
}

export type MusicRemixPlan =
  | { ok: true; segments: MusicRemixSegment[]; seams: MusicRemixSeam[]; durationSeconds: number; overshootSeconds: number; beatsPlayed: number; loopBeats: number[] }
  | { ok: false; code: 'not_rhythmic' | 'too_short' | 'target_too_short' | 'target_too_long' | 'no_transitions'; message: string; minSeconds?: number; maxSeconds?: number }

const CANDIDATES_PER_BEAT = 10
const MAX_TRANSITION_COST = 0.8
const JUMP_BASE_COST = 0.15
const SECTION_BONUS = 0.1
const OVERSHOOT_COST = 0.3
const REPETITION_WEIGHT = 1.5
const MAX_TARGET_RATIO = 8
const MAX_LAYERS = 6000

function median(values: number[]): number {
  if (!values.length) return 1
  values.sort((a, b) => a - b)
  return values[values.length >> 1] || 1
}

/** 可复现的 [0,1) 扰动（整数哈希），只在 seed 非 0 时使用。 */
function noise(seed: number, a: number, b: number): number {
  let h = (seed * 374761393 + a * 668265263 + b * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

interface Distances { (a: number, b: number): number }

/** 两拍差异：色度余弦距离、标准化音色欧氏距离、响度差，按整曲随机对的中位数归一（≈1 表示“像随便两拍”）。 */
function beatDistance(analysis: MusicAnalysis, offset: number, count: number): Distances {
  const { chroma, timbre, loudness } = analysis
  const scale = new Float64Array(MUSIC_TIMBRE_DIMS)
  for (let d = 0; d < MUSIC_TIMBRE_DIMS; d++) {
    let mean = 0, square = 0
    for (let i = 0; i < count; i++) { const v = timbre[(offset + i) * MUSIC_TIMBRE_DIMS + d]; mean += v; square += v * v }
    mean /= count
    scale[d] = Math.sqrt(Math.max(1e-12, square / count - mean * mean))
  }
  const parts = (a: number, b: number): [number, number, number] => {
    let dot = 0, t = 0
    for (let c = 0; c < 12; c++) dot += chroma[a * 12 + c] * chroma[b * 12 + c]
    for (let d = 0; d < MUSIC_TIMBRE_DIMS; d++) t += ((timbre[a * MUSIC_TIMBRE_DIMS + d] - timbre[b * MUSIC_TIMBRE_DIMS + d]) / scale[d]) ** 2
    return [1 - dot, Math.sqrt(t / MUSIC_TIMBRE_DIMS), Math.abs(loudness[a] - loudness[b])]
  }
  const samples: [number[], number[], number[]] = [[], [], []]
  const stride = Math.max(1, Math.floor(count / 40))
  for (let a = 0; a < count; a += stride) for (let b = a + 1; b < count; b += stride) parts(offset + a, offset + b).forEach((value, k) => samples[k].push(value))
  const norms = samples.map(median)
  return (a, b) => { const [c, t, l] = parts(a, b); return 0.5 * c / norms[0] + 0.35 * t / norms[1] + 0.15 * l / Math.max(norms[2], 1) }
}

interface Transition { to: number; cost: number; quality: number }

export function planMusicRemix(request: MusicRemixRequest): MusicRemixPlan {
  const { analysis } = request
  if (!analysis.suitable) return { ok: false, code: 'not_rhythmic', message: analysis.unsuitableReason ?? '这段音乐没有稳定节拍，不适合重构。' }
  const start = request.sourceStartSeconds, end = Math.min(request.sourceEndSeconds, analysis.durationSeconds)
  const bpb = analysis.beatsPerBar
  const offset = analysis.beats.findIndex(time => time >= start)
  let last = offset
  while (last >= 0 && last + 1 < analysis.beats.length && analysis.beats[last + 1] < end - 0.05) last++
  const n = offset < 0 ? 0 : last - offset + 1
  if (n < bpb * 4) return { ok: false, code: 'too_short', message: `片段里只有 ${n} 拍，至少需要 4 小节才能重构。` }
  const beat = (i: number): number => analysis.beats[offset + i]
  const pos = (i: number): number => analysis.barPositions[offset + i]
  const intro = beat(0) - start, outro = end - beat(n - 1)
  const length = (i: number): number => i < n - 1 ? beat(i + 1) - beat(i) : outro
  const margin = request.marginSeconds ?? 0
  const target = request.targetSeconds
  if (target > (end - start) * MAX_TARGET_RATIO) return { ok: false, code: 'target_too_long', message: `目标时长超过原片段的 ${MAX_TARGET_RATIO} 倍，请缩短目标。`, maxSeconds: (end - start) * MAX_TARGET_RATIO }

  // 段落：首段为前奏（不允许跳入），末段为尾奏（不允许从其中跳出）；段内每 4 小节为乐句起点。
  const sectionStarts = analysis.sections.map(section => section.startBeat - offset)
  const sectionOf = (i: number): number => { let s = 0; for (let k = 0; k < sectionStarts.length; k++) if (sectionStarts[k] <= i) s = k; return s }
  const introEnd = Math.max(1, Math.min(Math.floor(n / 4), sectionStarts.find(value => value > 0) ?? 1))
  const outroStart = Math.max(introEnd + 1, n - Math.min(Math.floor(n / 4), n - (sectionStarts.filter(value => value < n - 1).at(-1) ?? n - 1)))
  const phraseStart = new Uint8Array(n)
  for (let i = 0, bar = 0, section = -1; i < n; i++) {
    const s = sectionOf(i)
    if (s !== section) { section = s; bar = 0 }
    if (pos(i) === 0) { if (bar % 4 === 0) phraseStart[i] = 1; bar++ }
  }
  const isSectionStart = new Uint8Array(n)
  for (const value of sectionStarts) if (value >= 0 && value < n) isSectionStart[value] = 1

  const granularity = request.granularity
  const unit = (i: number): number => granularity === 'beat' ? 1 : pos(i) === 0 ? 1 : 0
  const minRun = granularity === 'beat' ? 2 : granularity === 'bar' ? 1 : 4
  const R = minRun + 1
  const canLeaveAt = (next: number): boolean => pos(next) >= 0 && (granularity === 'beat' || (granularity === 'bar' ? pos(next) === 0 : phraseStart[next] === 1))
  const canLandAt = (to: number): boolean => granularity !== 'phrase' || phraseStart[to] === 1

  const distance = beatDistance(analysis, offset, n)
  const lambda = REPETITION_WEIGHT * (1 - Math.min(1, Math.max(0, request.repetition)))
  const loopScale = 32 * bpb
  const transitions: Transition[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i + 1 < n; i++) {
    const next = i + 1
    if (next > outroStart || !canLeaveAt(next)) continue
    const options: Transition[] = []
    for (let j = introEnd; j < n; j++) {
      if (Math.abs(j - next) < bpb || pos(j) !== pos(next) || !canLandAt(j)) continue
      // 接缝前后的上下文：替换后听到的 j, j+1, j+2 与原本的 next, next+1, next+2 比，跳出前的 i, i-1 与 j-1, j-2 比。
      let sum = 0, weights = 0
      const terms: Array<[number, number, number]> = [[0, next, j], [0, next + 1, j + 1], [0, next + 2, j + 2], [1, i, j - 1], [1, i - 1, j - 2]]
      const termWeights = [1, 0.6, 0.35, 0.8, 0.4]
      terms.forEach(([, a, b], k) => { if (a >= 0 && b >= 0 && a < n && b < n) { sum += termWeights[k] * distance(offset + a, offset + b); weights += termWeights[k] } })
      const quality = sum / weights
      if (quality > MAX_TRANSITION_COST) continue
      const loop = j <= i ? next - j : 0
      const repetition = loop ? lambda * Math.max(0, 1 - loop / loopScale) : 0
      const bonus = isSectionStart[next] && isSectionStart[j] ? SECTION_BONUS : 0
      const jitter = request.seed ? 0.08 * noise(request.seed, offset + i, offset + j) : 0
      options.push({ to: j, cost: quality + JUMP_BASE_COST + repetition - bonus + jitter, quality })
    }
    options.sort((a, b) => a.cost - b.cost)
    transitions[i] = options.slice(0, CANDIDATES_PER_BEAT)
  }

  // 逐层动态规划：层 k 的状态 (拍 i, 跳转后已走单位数 r) 表示恰好播放了 k 拍、刚播完拍 i。
  const states = n * R
  const fixed = intro
  const meanBeat = (beat(n - 1) - beat(0)) / (n - 1)
  // 拍长有波动：多走 10% 与 8 小节，保证覆盖目标及其后两小节内的全部终点。
  const layerLimit = Math.min(MAX_LAYERS, Math.ceil((target + margin - fixed) / meanBeat * 1.1) + 8 * bpb + 2)
  let cost = new Float64Array(states).fill(Infinity), duration = new Float64Array(states)
  const back: Int32Array[] = []
  const first = Math.min(R - 1, unit(0))
  cost[first] = 0; duration[first] = length(0)
  back.push(new Int32Array(states).fill(-1))
  // 每层只留到达最后一拍的最低代价终点。
  const finals: Array<{ layer: number; state: number; cost: number; duration: number }> = []
  const record = (layer: number): void => {
    let best = -1
    for (let r = 0; r < R; r++) { const state = (n - 1) * R + r; if (cost[state] < (best < 0 ? Infinity : cost[best])) best = state }
    if (best >= 0) finals.push({ layer, state: best, cost: cost[best], duration: fixed + duration[best] })
  }
  record(0)
  for (let layer = 1; layer < layerLimit; layer++) {
    const nextCost = new Float64Array(states).fill(Infinity), nextDuration = new Float64Array(states), pointer = new Int32Array(states).fill(-1)
    let any = false
    for (let state = 0; state < states; state++) {
      const base = cost[state]
      if (base === Infinity) continue
      const i = Math.floor(state / R), r = state % R
      if (i === n - 1) continue
      const relax = (to: number, run: number, step: number): void => {
        const target = to * R + run, value = base + step
        if (value < nextCost[target]) { nextCost[target] = value; nextDuration[target] = duration[state] + length(to); pointer[target] = state; any = true }
      }
      relax(i + 1, Math.min(R - 1, r + unit(i + 1)), 0)
      if (r >= minRun) for (const option of transitions[i]) relax(option.to, Math.min(R - 1, unit(option.to)), option.cost)
    }
    cost = nextCost; duration = nextDuration; back.push(pointer)
    if (!any) break
    record(layer)
  }
  if (!finals.length) return { ok: false, code: 'no_transitions', message: '找不到能无缝衔接的位置，这段音乐难以重构。' }
  const minSeconds = Math.min(...finals.map(item => item.duration))
  // 比最短可行结果还短一小节以上：只能靠硬截，拒绝并给出下限。
  if (target + margin < minSeconds - bpb * meanBeat) return { ok: false, code: 'target_too_short', message: `最短只能重构到约 ${Math.ceil(minSeconds)} 秒（保留前奏与尾奏）。`, minSeconds }
  const reachable = finals.filter(item => item.duration >= target + margin - 1e-9)
  if (!reachable.length) {
    const longest = Math.max(...finals.map(item => item.duration))
    return { ok: false, code: 'no_transitions', message: `找不到足够多能无缝衔接的位置，目前最长只能重构到约 ${Math.floor(longest)} 秒。`, maxSeconds: longest }
  }
  // 多出的部分要在尾奏截掉：每多截一小节记 OVERSHOOT_COST，换取更自然的接缝；最多多截一小节。
  const barSeconds = bpb * meanBeat
  const shortest = Math.min(...reachable.map(item => item.duration))
  const score = (item: typeof reachable[number]): number => item.cost + OVERSHOOT_COST * (item.duration - target) / barSeconds
  const chosen = reachable.filter(item => item.duration <= shortest + barSeconds + 1e-9).sort((a, b) => score(a) - score(b) || a.duration - b.duration)[0]

  const played: number[] = []
  for (let layer = chosen.layer, state = chosen.state; layer >= 0 && state >= 0; state = back[layer][state], layer--) played.push(Math.floor(state / R))
  played.reverse()
  const runs: Array<[number, number]> = []
  for (const index of played) {
    const run = runs.at(-1)
    if (run && index === run[1] + 1) run[1] = index
    else runs.push([index, index])
  }
  const segments: MusicRemixSegment[] = [], seams: MusicRemixSeam[] = [], loops: number[] = []
  let time = 0
  runs.forEach(([a, e], k) => {
    const from = k === 0 ? start : beat(a)
    const to = k === runs.length - 1 ? end : beat(e + 1)
    let gainDb = 0
    if (k > 0) {
      const [, previous] = runs[k - 1]
      const option = transitions[previous].find(item => item.to === a)
      const natural = previous + 1
      const difference = analysis.loudness[offset + natural] - analysis.loudness[offset + a]
      gainDb = Math.abs(difference) >= 1 ? Math.max(-2, Math.min(2, difference / 2)) : 0
      if (a <= previous) loops.push(natural - a)
      seams.push({ timelineSeconds: time, fromBeat: offset + previous, toBeat: offset + a, confidence: Math.round(Math.exp(-1.5 * (option?.quality ?? MAX_TRANSITION_COST)) * 1000) / 1000, kind: a <= previous ? 'repeat' : 'skip' })
    }
    segments.push({ sourceStartSeconds: from, sourceEndSeconds: to, timelineSeconds: time, firstBeat: offset + a, lastBeat: offset + e, gainDb: Math.round(gainDb * 100) / 100 })
    time += to - from
  })
  return { ok: true, segments, seams, durationSeconds: time, overshootSeconds: time - target, beatsPlayed: played.length, loopBeats: loops }
}
