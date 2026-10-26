/*
 * 口水音（口腔咔嗒声、唇齿音“咔啦”“吧唧”）检测：纯算法，只找位置；修复交给 declick 的 LPC 插值。
 *
 * 依据：咔嗒是 0.3–10 ms 的宽频瞬态，能量集中在 2 kHz 以上；语音在短时内可以用线性预测（AR 模型）很好地描述，
 * 咔嗒则任何局部模型都预测不了，会在预测残差里留下孤立的尖峰。这和 FFmpeg adeclick（AR 模型残差超阈值）、
 * 去咔嗒文献里的“AR 残差检测”同一思路；本实现自研，不用二阶差分的峰度（避开 US 12682911 的方法）。
 *
 * 1. 4 阶巴特沃斯高通 2 kHz，去掉浊音的大部分能量；块与块之间延续滤波状态，结果与一次滤完逐位相同。
 * 2. 每 20 ms 一帧（对齐绝对位置），对高通信号做 16 阶 LPC（自相关法 + 汉宁窗，两侧各多看 2.5 ms），
 *    得到预测残差。帧内有超过本帧尺度 10 倍的突起时挖掉突起重估一次系数，免得模型迁就咔嗒。
 * 3. 稳健尺度：残差绝对值在 20 ms 窗（10 ms 步长）里的中位数 / 0.6745，每个样本取覆盖它的两个窗里较大的；
 *    残差除以尺度得 z。z 偏大的样本再用前后两帧的模型各预测一次取最小，声音在帧内变化（起声、擦音开头）
 *    换个模型就能预测，咔嗒不能。
 * 4. z 超过 5 的样本按 1 ms 间隔成组作为候选（超过 10 ms 的不是咔嗒），逐个看：
 *    - 突起：峰值附近 1 ms 的高频功率、残差功率，分别相对前 1.5–9.5 ms、后 3–11 ms 较响一侧的平均功率，取较大的；
 *      很响的元音段里残差尺度跟着变大，正常起伏不会突起；擦音、塞音送气（持续的宽频噪声）前后都响，也不突起。
 *    - 浊音的声门脉冲：前后 45 ms 里幅度不低于它一半的残差峰按基音周期（2.5–14 ms）规律排开，从该峰往两边数
 *      连续至少 3 段间隔都是一个周期，且它不比前后一两个周期处的脉冲强 1.5 倍以上，就是声门脉冲；
 *      成串的咔啦声间隔杂乱，凑不出这样的列。
 *    - 紧接着起声：之后 4–12 ms 和 12–30 ms 的全频功率都比之前 3–30 ms 高（取两段里较低的），超出 6 dB 的部分
 *      每 dB 扣 2 dB。塞音除阻（b/d/g 的爆破后马上接元音）和咔嗒在信号上分不开，宁可漏掉贴着字头的咔嗒，
 *      也不把辅音修掉；咔嗒自己的衰减尾巴只占前一段，字头前隔着空当的咂嘴声只占后一段，都不扣分。
 * 5. 证据（dB）= (20·lg z − 20) + (突起 dB − 9) − 起声扣分；灵敏度 50 要求证据 ≥ 0，每高 1 点门槛降 0.2 dB，
 *    突起下限 6 dB 也随灵敏度降低；灵敏度越高检出越多（单调）。score = 1/(1+e^(−证据/4))，与灵敏度无关。
 *    成串的咔啦声互相挡住突起：已确认的咔嗒前后 10 ms 内、残差峰本身够高（20·lg z − 20 − 起声扣分 ≥ 门槛）的
 *    候选一并算上，可以接力。
 * 6. 修复范围：残差超过 2.5 倍尺度的衰减尾巴（前 1 ms、后 3 ms 内）两侧各扩 widenMs，每段不超过 20 ms，
 *    离文件头尾至少 32 个样本；各声道合并，间隔不足 5 ms 的并成一段，并后超过 100 ms 的从最大的空隙处拆开。
 *
 * 分块处理（每块约 1.3 s，前后各多算 80 ms），候选只归属于起点所在的块，块边界不漏检也不重复，
 * 结果与块大小无关（逐位相同）；内容完全相同的声道只扫一次。
 * 调参依据：实测口播（44.1 kHz，约 9.7 分钟）灵敏度 30/50/70 约每分钟 18/35/69 处；合成类元音 6–30 dB 的咔嗒
 * 灵敏度 50 召回约 91%，纯净与含擦音塞音的合成口播误检约每分钟 0.2 处。
 */

export interface AudioEditMouthClick { startFrame: number; endFrame: number; peakFrame: number; score: number }
export interface AudioEditMouthClickOptions {
  /** 0–100，默认 50；越高越灵敏 */
  sensitivity?: number
  /** 两侧扩大修复范围（毫秒），默认 1.5 */
  widenMs?: number
}

/** 检测阶段的候选与特征（供测试和调参） */
export interface AudioEditMouthClickCandidate {
  channel: number
  /** 残差超阈值的核心范围 [coreStart, coreEnd) */
  coreStart: number
  coreEnd: number
  /** 含衰减尾巴的范围 [start, end) */
  start: number
  end: number
  peak: number
  /** 残差峰值相对局部稳健尺度的倍数 */
  z: number
  /** 峰值附近 1 ms 的高频功率相对前后较响一侧的倍数 */
  prominence: number
  /** 同上，按 LPC 残差算 */
  residualProminence: number
  /** 之后 4–12 ms 与 12–30 ms 里较低的全频功率相对之前 3–30 ms 的倍数（紧接着起声） */
  onset: number
  /** 是否落在规律的声门脉冲列上 */
  periodic: boolean
}

const HIGHPASS_HZ = 2000
const FRAME_MS = 20
const LPC_ORDER = 16
const ANALYSIS_PAD_MS = 2.5
const OUTLIER_Z = 10
const CANDIDATE_Z = 5
const PULSE_Z = 3.5
const TAIL_Z = 2.5
const GROUP_GAP_MS = 1
const MAX_CORE_MS = 10
const CONTEXT_FRAMES = 4
const DEFAULT_BLOCK_FRAMES = 64
const PULSE_SEARCH_MS = 45
const MIN_PITCH_MS = 2.5
const MAX_PITCH_MS = 14
const PERIODIC_RATIO = 1.5
const EVIDENCE_PEAK_DB = 20
const EVIDENCE_RISE_DB = 9
const ONSET_FREE_DB = 6
const ONSET_SLOPE = 2
const EVIDENCE_PER_SENSITIVITY = 0.2
const MIN_RISE_DB = 6
const MIN_RISE_PER_SENSITIVITY = 0.04
const SCORE_SCALE_DB = 4
const CLUSTER_MS = 10
const CLUSTER_FLOOR_DB = -4
const MAX_SEGMENT_MS = 20
const MERGE_GAP_MS = 5
const MAX_MERGED_MS = 100
const EDGE_FRAMES = 32
const DEFAULT_SENSITIVITY = 50
const DEFAULT_WIDEN_MS = 1.5

const toFrames = (value: number, sampleRate: number): number => Math.max(1, Math.round(value * sampleRate / 1000))
const powerDb = (value: number): number => 10 * Math.log10(Math.max(1e-30, value))

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** 4 阶巴特沃斯高通（两节双二阶，RBJ 公式） */
function highpassSections(sampleRate: number): [Biquad, Biquad] {
  const f0 = Math.min(HIGHPASS_HZ, sampleRate * 0.25)
  const section = (q: number): Biquad => {
    const w0 = 2 * Math.PI * f0 / sampleRate
    const cos = Math.cos(w0)
    const alpha = Math.sin(w0) / (2 * q)
    const a0 = 1 + alpha
    return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: -2 * cos / a0, a2: (1 - alpha) / a0 }
  }
  return [section(0.5411961), section(1.306563)]
}

/** Levinson–Durbin：由自相关求预测误差滤波器 A(z)=1+Σa_k z^-k，a[0]=1 */
function levinson(r: Float64Array, a: Float64Array, scratch: Float64Array): void {
  a.fill(0)
  a[0] = 1
  let error = r[0]
  if (!(error > 0)) return
  for (let i = 1; i <= LPC_ORDER; i++) {
    let acc = r[i]
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j]
    const k = -acc / error
    for (let j = 1; j < i; j++) scratch[j] = a[j] + k * a[i - j]
    for (let j = 1; j < i; j++) a[j] = scratch[j]
    a[i] = k
    error *= 1 - k * k
    if (!(error > 0)) return
  }
}

/** 自相关 r[0..LPC_ORDER]（四路累加） */
function autocorrelate(values: Float64Array, r: Float64Array): void {
  const length = values.length
  for (let k = 0; k <= LPC_ORDER; k++) {
    let acc0 = 0, acc1 = 0, acc2 = 0, acc3 = 0
    let j = k
    for (; j + 3 < length; j += 4) {
      acc0 += values[j] * values[j - k]
      acc1 += values[j + 1] * values[j + 1 - k]
      acc2 += values[j + 2] * values[j + 2 - k]
      acc3 += values[j + 3] * values[j + 3 - k]
    }
    for (; j < length; j++) acc0 += values[j] * values[j - k]
    r[k] = (acc0 + acc1) + (acc2 + acc3)
  }
}

/** 第 k 小（0 起）的值，就地重排 values[0, length) */
function selectKth(values: Float64Array, length: number, k: number): number {
  let lo = 0
  let hi = length - 1
  while (hi > lo) {
    const a = values[lo], b = values[(lo + hi) >> 1], c = values[hi]
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b
    let i = lo
    let j = hi
    while (i <= j) {
      while (values[i] < pivot) i++
      while (values[j] > pivot) j--
      if (i <= j) { const t = values[i]; values[i] = values[j]; values[j] = t; i++; j-- }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else return values[k]
  }
  return values[k]
}

/** values[from, to) 绝对值的中位数换算成高斯标准差（隔一个取一个，够稳健也快一倍） */
function robustScale(values: Float64Array, from: number, to: number, scratch: Float64Array): number {
  let count = 0
  for (let i = from; i < to; i += 2) scratch[count++] = Math.abs(values[i])
  return count > 0 ? selectKth(scratch, count, count >> 1) / 0.6745 : 0
}

/** 单声道逐块扫描：块与块之间延续高通滤波状态，LPC 帧对齐到绝对位置，候选只归属于起点所在的块 */
function scanChannel(signal: Float32Array, channel: number, sampleRate: number, blockFrames: number, out: AudioEditMouthClickCandidate[]): void {
  const total = signal.length
  const ms = (value: number): number => toFrames(value, sampleRate)
  const half = ms(FRAME_MS / 2)
  const frame = 2 * half
  const pad = Math.max(LPC_ORDER, ms(ANALYSIS_PAD_MS))
  const context = CONTEXT_FRAMES * frame
  const block = Math.max(1, Math.floor(blockFrames)) * frame
  const window = frame + 2 * pad
  const hann = new Float64Array(window)
  for (let j = 0; j < window; j++) hann[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (j + 0.5) / window)
  const [s1, s2] = highpassSections(sampleRate)
  const { b0: p0, b1: p1, b2: p2, a1: q1, a2: q2 } = s1
  const { b0: r0, b1: r1, b2: r2, a1: t1, a2: t2 } = s2
  // 转置直接 II 型，每节两个状态
  let m1 = 0, m2 = 0, n1 = 0, n2 = 0
  const span = block + 2 * context
  const hp = new Float64Array(span + 2 * pad)
  let hpBase = 0
  let hpFilled = 0
  const residual = new Float64Array(span)
  const z = new Float64Array(span)
  const weighted = new Float64Array(window)
  const correlation = new Float64Array(LPC_ORDER + 1)
  const a = new Float64Array(LPC_ORDER + 1)
  const scratch = new Float64Array(LPC_ORDER + 1)
  const magnitudes = new Float64Array(frame)
  const sigmas = new Float64Array(Math.ceil(span / half) + 3)
  const models = new Float64Array((Math.ceil(span / frame) + 1) * (LPC_ORDER + 1))
  const frameScales = new Float64Array(Math.ceil(span / frame) + 1)
  const hits = new Int32Array(span)
  const gap = ms(GROUP_GAP_MS)
  const maxCore = ms(MAX_CORE_MS)
  const halfMs = ms(0.5)
  const minPitch = MIN_PITCH_MS * sampleRate / 1000
  const maxPitch = MAX_PITCH_MS * sampleRate / 1000
  const pulseSearch = ms(PULSE_SEARCH_MS)
  const pulseTolerance = ms(0.4)
  const outlierBefore = ms(0.25)
  const outlierAfter = ms(1)
  const minProminence = 10 ** ((MIN_RISE_DB - 50 * MIN_RISE_PER_SENSITIVITY) / 10)
  const minEvidence = -50 * EVIDENCE_PER_SENSITIVITY
  const clusterMinZ = 10 ** ((EVIDENCE_PEAK_DB + CLUSTER_FLOOR_DB) / 20)

  for (let blockStart = 0; blockStart < total; blockStart += block) {
    const blockEnd = Math.min(total, blockStart + block)
    const bufferStart = Math.max(0, blockStart - context)
    const bufferEnd = Math.min(total, blockEnd + context)
    const length = bufferEnd - bufferStart
    const lo = Math.max(0, bufferStart - pad)
    const hi = Math.min(total, bufferEnd + pad)

    // 高通：保留与上一块重叠的部分，接着滤波到 hi；非有限值按 0 处理
    if (lo > hpBase) {
      hp.copyWithin(0, lo - hpBase, hpFilled - hpBase)
      hpBase = lo
    }
    {
      const target = hp
      const base = hpBase
      for (let n = hpFilled; n < hi; n++) {
        const value = signal[n]
        const x = value - value === 0 ? value : 0
        const y = p0 * x + m1
        m1 = p1 * x - q1 * y + m2
        m2 = p2 * x - q2 * y
        const w = r0 * y + n1
        n1 = r1 * y - t1 * w + n2
        n2 = r2 * y - t2 * w
        target[n - base] = w
      }
    }
    hpFilled = Math.max(hpFilled, hi)
    const hpAt = (n: number): number => (n >= lo && n < hi ? hp[n - hpBase] : 0)

    // 逐帧 LPC 残差；帧里有远超本帧尺度的突起时挖掉突起再估一次系数
    const fit = (): void => {
      autocorrelate(weighted, correlation)
      correlation[0] *= 1 + 1e-5
      levinson(correlation, a, scratch)
    }
    const filter = (frameStart: number, frameEnd: number): void => {
      const c0 = a[0], c1 = a[1], c2 = a[2], c3 = a[3], c4 = a[4], c5 = a[5], c6 = a[6], c7 = a[7], c8 = a[8]
      const c9 = a[9], c10 = a[10], c11 = a[11], c12 = a[12], c13 = a[13], c14 = a[14], c15 = a[15], c16 = a[16]
      let n = frameStart
      for (; n < frameEnd && n - LPC_ORDER < lo; n++) {
        let acc = 0
        for (let k = 0; k <= LPC_ORDER; k++) acc += a[k] * hpAt(n - k)
        residual[n - bufferStart] = acc
      }
      const x = hp
      const out = residual
      const shift = bufferStart - hpBase
      for (let i = n - hpBase; i < frameEnd - hpBase; i++) {
        out[i - shift] = c0 * x[i] + c1 * x[i - 1] + c2 * x[i - 2] + c3 * x[i - 3] + c4 * x[i - 4] + c5 * x[i - 5] +
          c6 * x[i - 6] + c7 * x[i - 7] + c8 * x[i - 8] + c9 * x[i - 9] + c10 * x[i - 10] + c11 * x[i - 11] +
          c12 * x[i - 12] + c13 * x[i - 13] + c14 * x[i - 14] + c15 * x[i - 15] + c16 * x[i - 16]
      }
    }
    for (let frameStart = bufferStart; frameStart < bufferEnd; frameStart += frame) {
      const frameEnd = Math.min(bufferEnd, frameStart + frame)
      const windowStart = frameStart - pad
      if (windowStart >= lo && windowStart + window <= hi) {
        const base = windowStart - hpBase
        const x = hp, out = weighted, taper = hann
        for (let j = 0; j < window; j++) out[j] = x[base + j] * taper[j]
      } else {
        for (let j = 0; j < window; j++) weighted[j] = hpAt(windowStart + j) * hann[j]
      }
      fit()
      filter(frameStart, frameEnd)
      const scale = robustScale(residual, frameStart - bufferStart, frameEnd - bufferStart, magnitudes)
      const limit = OUTLIER_Z * scale
      let masked = false
      const res = residual
      for (let i = frameStart - bufferStart; i < frameEnd - bufferStart; i++) {
        if (!(Math.abs(res[i]) > limit)) continue
        const n = i + bufferStart
        weighted.fill(0, Math.max(0, n - outlierBefore - windowStart), Math.min(window, n + outlierAfter - windowStart))
        masked = true
      }
      const index = (frameStart - bufferStart) / frame
      if (masked) {
        fit()
        filter(frameStart, frameEnd)
      }
      // 没重估的整帧与对齐它的尺度窗是同一段残差，尺度直接复用
      frameScales[index] = masked || frameEnd - frameStart < frame ? -1 : scale
      models.set(a, index * (LPC_ORDER + 1))
    }

    // 稳健尺度：20 ms 窗、10 ms 步长（对齐绝对位置），取覆盖该样本的两个窗里较大的；
    // z 偏大的样本再用前后帧的模型各预测一次，取最小的残差
    const firstWindow = Math.floor(bufferStart / half) - 1
    const lastWindow = Math.floor((bufferEnd - 1) / half)
    for (let k = firstWindow; k <= lastWindow; k++) {
      const from = Math.max(bufferStart, k * half) - bufferStart
      const to = Math.min(bufferEnd, k * half + frame) - bufferStart
      const aligned = from === k * half - bufferStart && from % frame === 0 ? frameScales[from / frame] : -1
      sigmas[k - firstWindow] = Math.max(1e-12, aligned >= 0 && to - from === frame ? aligned : robustScale(residual, from, to, magnitudes))
    }
    const frames = Math.ceil(length / frame)
    let found = 0
    const res = residual, scores = z, found2 = hits, source = hp, coefficients = models, base0 = hpBase
    for (let k = firstWindow + 1; k <= lastWindow; k++) {
      const sigma = Math.max(sigmas[k - firstWindow], sigmas[k - 1 - firstWindow])
      const inverse = 1 / sigma
      const pulseLimit = PULSE_Z * sigma
      const from = Math.max(bufferStart, k * half)
      const to = Math.min(bufferEnd, (k + 1) * half)
      for (let i = from - bufferStart; i < to - bufferStart; i++) {
        let value = res[i]
        if (Math.abs(value) > pulseLimit && i + bufferStart - LPC_ORDER >= lo) {
          const own = Math.floor(i / frame)
          const base = i + bufferStart - base0
          for (let other = own - 1; other <= own + 1; other += 2) {
            if (other < 0 || other >= frames) continue
            const offset = other * (LPC_ORDER + 1)
            let acc = 0
            for (let j = 0; j <= LPC_ORDER; j++) acc += coefficients[offset + j] * source[base - j]
            if (Math.abs(acc) < Math.abs(value)) value = acc
          }
          res[i] = value
        }
        const score = Math.abs(value) * inverse
        scores[i] = score
        if (score > CANDIDATE_Z) found2[found++] = i
      }
    }

    /** [from, to) 的均方（超出文件的部分不计），缓冲区以外视为 0 */
    const meanSquare = (values: Float64Array, base: number, validFrom: number, validTo: number, from: number, to: number): number => {
      const count = Math.min(total, to) - Math.max(0, from)
      if (count <= 0) return 0
      let acc = 0
      for (let n = Math.max(from, validFrom); n < Math.min(to, validTo); n++) { const v = values[n - base]; acc += v * v }
      return acc / count
    }
    const hpPower = (from: number, to: number): number => meanSquare(hp, hpBase, lo, hi, from, to)
    const residualPower = (from: number, to: number): number => meanSquare(residual, bufferStart, bufferStart, bufferEnd, from, to)
    const fullPower = (from: number, to: number): number => {
      const start = Math.max(0, from)
      const end = Math.min(total, to)
      if (end <= start) return 0
      let acc = 0
      for (let n = start; n < end; n++) { const v = signal[n]; if (v - v === 0) acc += v * v }
      return acc / (end - start)
    }

    /** 该峰（缓冲区下标）是否落在规律出现、幅度相当的残差脉冲列上（浊音的声门脉冲） */
    const isPeriodic = (peak: number): boolean => {
      const magnitude = Math.abs(residual[peak])
      const threshold = 0.5 * magnitude
      const offsets: number[] = [0]
      const from = Math.max(0, peak - pulseSearch)
      const to = Math.min(length, peak + pulseSearch + 1)
      let clusterPeak = -1
      let clusterLast = -2 * gap - 1
      const push = (): void => { if (clusterPeak >= 0 && Math.abs(clusterPeak - peak) > gap) offsets.push(clusterPeak - peak) }
      for (let i = from; i < to; i++) {
        const value = Math.abs(residual[i])
        if (value <= threshold || z[i] <= PULSE_Z) continue
        if (i - clusterLast > gap) { push(); clusterPeak = i } else if (value > Math.abs(residual[clusterPeak])) clusterPeak = i
        clusterLast = i
      }
      push()
      if (offsets.length < 3) return false
      offsets.sort((x, y) => x - y)
      // 相邻脉冲（含该峰自己）的间隔估出基音周期：至少两段间隔落在基音范围内且彼此相近
      const intervals: number[] = []
      for (let i = 1; i < offsets.length; i++) {
        const interval = offsets[i] - offsets[i - 1]
        if (interval >= minPitch && interval <= maxPitch) intervals.push(interval)
      }
      if (intervals.length < 2) return false
      intervals.sort((x, y) => x - y)
      const period = intervals[intervals.length >> 1]
      const tolerance = Math.max(pulseTolerance, 0.15 * period)
      if (intervals.filter((interval) => Math.abs(interval - period) <= tolerance).length < 2) return false
      // 该峰在脉冲列上：从它往两边数，连续至少 3 段间隔都是一个周期（漏掉一个脉冲的两倍间隔可以跳过）；
      // 成串的咔啦声间隔杂乱，凑不出这么规整的列
      const index = offsets.indexOf(0)
      const regular = (from: number, step: number): number => {
        let count = 0
        for (let i = from; i + step >= 0 && i + step < offsets.length; i += step) {
          const interval = Math.abs(offsets[i + step] - offsets[i])
          if (Math.abs(interval - period) <= tolerance) count++
          else if (Math.abs(interval - 2 * period) > 2 * tolerance || count === 0) break
        }
        return count
      }
      if (regular(index, -1) + regular(index, 1) < 3) return false
      // 比前后一两个周期处的脉冲明显更强的峰是叠在声门脉冲上的咔嗒
      const strengths: number[] = []
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue
        const start = Math.max(0, Math.round(peak + k * period - tolerance))
        const end = Math.min(length, Math.round(peak + k * period + tolerance) + 1)
        if (end <= start) continue
        let best = 0
        for (let i = start; i < end; i++) best = Math.max(best, Math.abs(residual[i]))
        strengths.push(best)
      }
      strengths.sort((x, y) => x - y)
      return magnitude <= PERIODIC_RATIO * strengths[strengths.length >> 1]
    }

    const describe = (first: number, last: number): AudioEditMouthClickCandidate | null => {
      let peak = first
      for (let i = first; i <= last; i++) if (z[i] > z[peak]) peak = i
      const at = peak + bufferStart
      const coreStart = first + bufferStart
      const coreEnd = last + 1 + bufferStart
      const beforeFrom = coreStart - ms(9.5), beforeTo = coreStart - ms(1.5)
      const afterFrom = coreEnd + ms(3), afterTo = coreEnd + ms(11)
      const prominence = hpPower(at - halfMs, at + halfMs + 1) /
        Math.max(1e-30, hpPower(beforeFrom, beforeTo), hpPower(afterFrom, afterTo))
      const residualProminence = residualPower(at - halfMs, at + halfMs + 1) /
        Math.max(1e-30, residualPower(beforeFrom, beforeTo), residualPower(afterFrom, afterTo))
      // 残差峰够高的留给成串咔嗒接力，哪怕自己不突起
      const strong = z[peak] >= clusterMinZ
      if (!(Math.max(prominence, residualProminence) >= minProminence) && !strong) return null
      // 紧接着起声：之后 4–12 ms 和 12–30 ms 都比之前响（咔嗒自己的衰减尾巴只占前一段，字头前的咔嗒只占后一段）
      const onset = Math.min(fullPower(coreEnd + ms(4), coreEnd + ms(12)), fullPower(coreEnd + ms(12), coreEnd + ms(30))) / Math.max(1e-30, fullPower(coreStart - ms(30), coreStart - ms(3)))
      const partial = { z: z[peak], prominence, residualProminence, onset }
      if (!(evidenceOf(partial) >= minEvidence) && !(clusterEvidenceOf(partial) >= CLUSTER_FLOOR_DB)) return null
      let start = first
      const leftLimit = Math.max(0, first - ms(1))
      while (start > leftLimit && z[start - 1] > TAIL_Z) start--
      let end = last + 1
      const rightLimit = Math.min(length, last + 1 + ms(3))
      while (end < rightLimit && z[end] > TAIL_Z) end++
      return {
        channel, coreStart, coreEnd, start: start + bufferStart, end: end + bufferStart, peak: at,
        ...partial, periodic: isPeriodic(peak),
      }
    }

    // 候选：z 超过阈值的样本按 1 ms 间隔成组，只保留起点落在本块里、不超过 10 ms 的
    let groupStart = -1
    let groupEnd = -1
    const flush = (): void => {
      if (groupStart < 0) return
      const start = groupStart + bufferStart
      if (start >= blockStart && start < blockEnd && groupEnd - groupStart + 1 <= maxCore) {
        const candidate = describe(groupStart, groupEnd)
        if (candidate) out.push(candidate)
      }
      groupStart = -1
    }
    for (let h = 0; h < found; h++) {
      const i = hits[h]
      if (groupStart >= 0 && i - groupEnd > gap) flush()
      if (groupStart < 0) groupStart = i
      groupEnd = i
    }
    flush()
  }
}

type EvidenceInput = Pick<AudioEditMouthClickCandidate, 'z' | 'prominence' | 'residualProminence' | 'onset'>

/** 证据（dB）：残差峰与突起之和，紧接着起声的扣分；灵敏度 50 的门槛为 0 */
function evidenceOf(candidate: EvidenceInput): number {
  const peak = 20 * Math.log10(Math.max(1e-12, candidate.z))
  const rise = powerDb(Math.max(candidate.prominence, candidate.residualProminence))
  return (peak - EVIDENCE_PEAK_DB) + (rise - EVIDENCE_RISE_DB) - ONSET_SLOPE * Math.max(0, powerDb(candidate.onset) - ONSET_FREE_DB)
}

/** 成串咔嗒里的接力证据：只看残差峰与起声扣分，不要求相对前后突起 */
function clusterEvidenceOf(candidate: EvidenceInput): number {
  return 20 * Math.log10(Math.max(1e-12, candidate.z)) - EVIDENCE_PEAK_DB - ONSET_SLOPE * Math.max(0, powerDb(candidate.onset) - ONSET_FREE_DB)
}

/** 找出所有声道的候选（按声道、时间排序）；内容完全相同的声道只扫一次。blockFrames 为每块的 LPC 帧数 */
export function scanAudioEditMouthClickCandidates(channels: readonly Float32Array[], sampleRate: number, blockFrames = DEFAULT_BLOCK_FRAMES): AudioEditMouthClickCandidate[] {
  const out: AudioEditMouthClickCandidate[] = []
  if (!(sampleRate > 0) || channels.length === 0) return out
  const length = Math.min(...channels.map((channel) => channel.length))
  if (length === 0) return out
  const distinct: number[] = []
  channels.forEach((channel, index) => {
    const same = distinct.some((other) => {
      const reference = channels[other]
      for (let i = 0; i < length; i++) if (reference[i] !== channel[i]) return false
      return true
    })
    if (!same) distinct.push(index)
  })
  for (const index of distinct) scanChannel(channels[index].subarray(0, length), index, sampleRate, blockFrames, out)
  return out
}

interface Segment { startFrame: number; endFrame: number; peakFrame: number; score: number }

/** 并成一段；超过上限时从最大的空隙处拆开，拆不开（互相重叠）就只留得分最高的那处周围 */
function mergeGroup(members: Segment[], maxLength: number): Segment[] {
  const startFrame = members[0].startFrame
  const endFrame = Math.max(...members.map((member) => member.endFrame))
  const best = members.reduce((top, member) => (member.score > top.score ? member : top))
  if (endFrame - startFrame <= maxLength) return [{ startFrame, endFrame, peakFrame: best.peakFrame, score: best.score }]
  let split = -1
  let widest = 0
  let reach = members[0].endFrame
  for (let i = 1; i < members.length; i++) {
    const space = members[i].startFrame - reach
    if (space > widest) { widest = space; split = i }
    reach = Math.max(reach, members[i].endFrame)
  }
  if (split < 0) {
    const from = Math.max(startFrame, Math.min(best.peakFrame - (maxLength >> 1), endFrame - maxLength))
    return [{ startFrame: from, endFrame: from + maxLength, peakFrame: best.peakFrame, score: best.score }]
  }
  return [...mergeGroup(members.slice(0, split), maxLength), ...mergeGroup(members.slice(split), maxLength)]
}

/** channels 为逐声道的 Float32Array（同长度），返回按时间排序、互不重叠的修复范围 */
export function detectAudioEditMouthClicks(channels: readonly Float32Array[], sampleRate: number, options: AudioEditMouthClickOptions = {}): AudioEditMouthClick[] {
  if (!(sampleRate > 0) || channels.length === 0) return []
  const total = Math.min(...channels.map((channel) => channel.length))
  if (total < 2 * EDGE_FRAMES + 1) return []
  const raw = options.sensitivity ?? DEFAULT_SENSITIVITY
  const sensitivity = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : DEFAULT_SENSITIVITY
  const widenMs = options.widenMs ?? DEFAULT_WIDEN_MS
  const widen = Number.isFinite(widenMs) && widenMs > 0 ? Math.round(widenMs * sampleRate / 1000) : 0
  const required = (DEFAULT_SENSITIVITY - sensitivity) * EVIDENCE_PER_SENSITIVITY
  const minRise = MIN_RISE_DB - (sensitivity - DEFAULT_SENSITIVITY) * MIN_RISE_PER_SENSITIVITY
  const maxSegment = toFrames(MAX_SEGMENT_MS, sampleRate)
  const candidates = scanAudioEditMouthClickCandidates(channels, sampleRate).filter((candidate) => !candidate.periodic).sort((x, y) => x.peak - y.peak)
  const chosen = candidates.map((candidate) => evidenceOf(candidate) >= required && powerDb(Math.max(candidate.prominence, candidate.residualProminence)) >= minRise)
  // 成串的咔啦声互相挡住了突起：已确认的咔嗒前后 CLUSTER_MS 内、残差峰本身够高的候选一并算上（可以接力）
  const cluster = toFrames(CLUSTER_MS, sampleRate)
  for (let grown = true; grown;) {
    grown = false
    for (let i = 0; i < candidates.length; i++) {
      if (chosen[i] || !(clusterEvidenceOf(candidates[i]) >= Math.max(required, CLUSTER_FLOOR_DB))) continue
      const peak = candidates[i].peak
      let near = false
      for (let j = i - 1; j >= 0 && candidates[j].peak >= peak - cluster && !near; j--) near = chosen[j]
      for (let j = i + 1; j < candidates.length && candidates[j].peak <= peak + cluster && !near; j++) near = chosen[j]
      if (near) { chosen[i] = true; grown = true }
    }
  }
  const segments: Segment[] = []
  candidates.forEach((candidate, index) => {
    if (!chosen[index]) return
    const evidence = evidenceOf(candidate)
    let startFrame = candidate.start - widen
    let endFrame = candidate.end + widen
    if (endFrame - startFrame > maxSegment) {
      // 太长时以峰值为准，多留峰后的衰减尾巴
      startFrame = Math.max(startFrame, Math.min(candidate.peak - (maxSegment >> 2), endFrame - maxSegment))
      endFrame = startFrame + maxSegment
    }
    startFrame = Math.max(EDGE_FRAMES, startFrame)
    endFrame = Math.min(total - EDGE_FRAMES, endFrame)
    if (endFrame <= startFrame) return
    const peakFrame = Math.min(endFrame - 1, Math.max(startFrame, candidate.peak))
    segments.push({ startFrame, endFrame, peakFrame, score: 1 / (1 + Math.exp(-evidence / SCORE_SCALE_DB)) })
  })
  segments.sort((x, y) => x.startFrame - y.startFrame || x.endFrame - y.endFrame)
  const mergeGap = toFrames(MERGE_GAP_MS, sampleRate)
  const maxMerged = toFrames(MAX_MERGED_MS, sampleRate)
  const result: AudioEditMouthClick[] = []
  let group: Segment[] = []
  let reach = -Infinity
  const close = (): void => { if (group.length) result.push(...mergeGroup(group, maxMerged)); group = [] }
  for (const segment of segments) {
    if (group.length && segment.startFrame - reach >= mergeGap) close()
    group.push(segment)
    reach = group.length === 1 ? segment.endFrame : Math.max(reach, segment.endFrame)
  }
  close()
  return result
}
