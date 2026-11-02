/* global sampleRate, currentFrame */
/**
 * 擦洗音频（拖动播放头试听）处理器：剪辑节目、源监视器与音频编辑共用，主线程入口见 audioScrubEngine.ts。
 *
 * 声音始终是原音高、原电平：每一段都按原速读原声，多声道用同一位置、同一接缝、同一包络，不做重采样变调或频域处理。
 * 拖动时按指针位置接续一段段原速声音（时域波形对齐叠接，WSOLA 一类做法），接缝用几毫秒的交叉淡化：
 * - 向前慢拖（比原速慢）：从指针处起按原速连续播放；声音领先指针超过 AHEAD 就往回接一小段（每次至多 REPEAT），
 *   接缝按波形相似度对齐（浊音按基音周期对上），声音一直不断、音高不变，平均速度等于拖动速度，位置始终贴着指针。
 *   往回接时不越过刚响过的音头（能量突增处）：辅音、敲击只响一次、和原声一样干脆，延长的只是音头之后的稳定部分。
 * - 向前快拖：声音落后指针超过 BEHIND 就跳到指针处，3ms 交叉淡化，接缝在 ±SEEK 内按波形对齐（一段段跟着指针的原速片段）。
 *   按原速拖动时就是连续播放，输出与原声逐样本相同。
 * - 向后拖：一块块原速声音沿指针往回铺（每块 CHUNK 长、正着放），已经放过的地方不再重放。
 * - 停住即收声；单步播放一小段原速声音。
 * - 轨迹：主线程逐次送来指针位置与事件时刻。按最近几次位置变化做最小二乘求速度与位置，超过预期间隔没有新位置就视为停住。
 * - 声音由主线程按固定长度的块提前送来；将要读到缺块的位置时先淡出为静音，块到了再淡入。
 *
 * 位置都以源采样帧计；时间以输出采样帧计。源与输出采样率不同时按固定比例带限插值（不改变音高）。
 */
/**
 * 向前拖时声音最多领先指针、最多落后指针多少（秒），按拖动速度自适应：慢拖时领先一小段就往回接（紧贴指针），
 * 接近原速时放宽，手速的自然起伏不会引出多余的接缝；快拖时落后一点就跳到指针处。跳之前当前段至少放 MIN_SEGMENT。
 */
const AHEAD = 0.03
const AHEAD_NEAR_UNIT = 0.09
const BEHIND = 0.03
const BEHIND_NEAR_UNIT = 0.05
const MIN_SEGMENT = 0.04
/**
 * 慢拖往回接：每次至多往回 REPEAT（秒），短到只是延长一两个基音周期，听不出重复的字；接上的一段至少 REPEAT_MIN 长，
 * 两次之间至少放 REPEAT_GAP。接缝在 ±REPEAT_SEEK（覆盖一个基音周期）内按 REPEAT_MATCH 长的波形找最相似处，
 * 交叉淡化 REPEAT_CROSSFADE。领先超过 REPEAT_LIMIT（音头密集，找不到可以延长的稳定部分）就不再避让音头，直接回到指针处。
 */
const REPEAT = 0.02
const REPEAT_MIN = 0.008
const REPEAT_GAP = 0.012
const REPEAT_SEEK = 0.006
const REPEAT_MATCH = 0.008
const REPEAT_CROSSFADE = 0.005
const REPEAT_LIMIT = 0.15
/**
 * 音头：从某一跳（ONSET_HOP 秒）起 ONSET_SPAN 跳长的窗口能量比它之前同样长的窗口高 ONSET_RATIO 倍（6dB）以上，且不是底噪；
 * 起音后 ONSET_HOLD 秒内的峰也算音头，不重放。
 */
const ONSET_HOP = 0.0025
const ONSET_SPAN = 5
const ONSET_RATIO = 4
const ONSET_FLOOR = 1e-6
const ONSET_HOLD = 0.01
/** 向后拖时每块的长度（秒）。 */
const CHUNK = 0.05
/** 淡入、淡出、接缝交叉淡化时长（秒）与接缝对齐的搜索范围。 */
const FADE_IN = 0.002
const FADE_OUT = 0.003
const CROSSFADE = 0.003
const SEEK = 0.003
const MISSING_FADE = 0.003
/** 接缝对齐粗找时隔几个起点试一次。 */
const COARSE = 3
/** 低于这个速度（相对原速）算停住。 */
const STILL = 0.02
/** 指针速度的方向判断带一点回差，速度在零附近抖动时不来回换向。 */
const TURN = 0.05
const STEP_ATTACK = 0.002
const STEP_RELEASE = 0.004
/**
 * 下一个位置该到而没到：再等“预期间隔 × 系数（至少若干秒）”仍照常跟随（吸收主线程抖动），之后在第二段时间内把速度收到零（停住）。
 */
const SLACK_FACTOR = 0.4
const SLACK_MIN = 0.008
const QUANTUM_JITTER = 1.2
const STOP_FACTOR = 0.5
const STOP_MIN = 0.012
const OVERDUE = 1.1
/**
 * 下一个位置预计多久到的上限（秒）：慢拖时指针（或按帧取整的位置）要隔很久才变一次，等得够久才不会把还在拖误判成停住。
 * 只在位置变化本来就稀（缩得很小的时间线、按帧取整）时才等这么久；位置变化密时按实际间隔判停。
 */
const DUE_MAX = 0.35
/** 速度按最近几次位置变化（至少、至多多长时间）做最小二乘。 */
const WINDOW_CHANGES = 3
const WINDOW_MIN = 0.06
const WINDOW_MAX = 0.2
const WINDOW_CHANGES_QUANTIZED = 5
const WINDOW_QUANTIZED = 0.1
const WINDOW_MAX_QUANTIZED = 0.25
const HISTORY = 0.4
/** 停住超过“停住时刻的两倍（至少这么久）”后再动，算新的一段拖动（重新从静止起步估计速度）。 */
const RESTART = 0.08
/** 单步时新位置与正在播放的位置相距不超过这么多（源秒）就接着播，不重新起音。 */
const STEP_JOIN = 0.06
const REPORT = 0.016
const MAX_BLOCKS = 160
/** 采样率不同时的带限插值核：每侧零点数、查表精度、Kaiser 窗参数与截止。 */
const ZEROS = 8
const RESOLUTION = 256
const BETA = 6.5
const ROLLOFF = 0.92

function besselI0(x) {
  let sum = 1, term = 1
  for (let k = 1; k < 50; k++) { term *= (x / (2 * k)) ** 2; sum += term; if (term < 1e-12 * sum) break }
  return sum
}
const TABLE_SIZE = ZEROS * RESOLUTION
const TABLE = (() => {
  const table = new Float64Array(TABLE_SIZE + 2)
  const norm = besselI0(BETA)
  for (let index = 0; index < TABLE_SIZE; index++) {
    const z = index / RESOLUTION
    const x = Math.PI * ROLLOFF * z
    table[index] = (z === 0 ? 1 : Math.sin(x) / x) * besselI0(BETA * Math.sqrt(1 - (z / ZEROS) ** 2)) / norm
  }
  return table
})()

const clamp = (value, low, high) => value < low ? low : value > high ? high : value

/** reference 与 window[offset..] 每隔 stride 个样本取一次的归一化互相关。 */
function similarity(reference, window, offset, length, stride) {
  let product = 0, energy = 0, referenceEnergy = 0
  for (let index = 0; index < length; index += stride) {
    const value = window[offset + index], base = reference[index]
    product += base * value; energy += value * value; referenceEnergy += base * base
  }
  return energy > 1e-12 && referenceEnergy > 1e-12 ? product / Math.sqrt(energy * referenceEnergy) : 0
}

/** 一段原速播放的声音：从源位置 start 起每个输出帧前进固定比例（同采样率时正好一帧）。 */
class Segment {
  constructor(start, end) {
    this.start = start
    this.played = 0
    /** 淡入淡出进度（0..1），包络取升余弦形状：一进一出相加恒为 1。 */
    this.fade = 0
    this.fadeTarget = 1
    this.fadeStep = 1
    this.avail = 1
    this.availTarget = 1
    /** 放到这个源位置前淡出（单步、倒拖的块）；向前拖的段为 undefined。 */
    this.end = end
    this.release = FADE_OUT
  }
  fadeTo(target, seconds) { this.fadeTarget = target; this.fadeStep = 1 / Math.max(1, seconds * sampleRate) }
}

class HenjiAudioScrubProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.key = undefined
    this.sourceRate = sampleRate
    this.channels = 1
    this.blockFrames = Math.round(sampleRate / 4)
    this.totalFrames = 0
    this.blocks = new Map()
    this.missed = new Set()
    this.segments = []
    /** 正在主播的那一段（拖动段、倒拖块或单步段）。 */
    this.current = null
    this.mode = 'idle'
    /** 拖动方向与已经放过的边界（向前拖：放到哪里了；向后拖：最早一块从哪里开始）。 */
    this.direction = 0
    this.edge = undefined
    this.plan = { velocity: 0, position: 0, weight: 0 }
    this.historyTime = []
    this.historyPosition = []
    this.lastPosition = undefined
    /** 最近一次位置变化的方向（-1 / 0 / 1）。 */
    this.lastStep = 0
    this.lastTime = 0
    /** 指针到达当前位置的时刻，与最近一次位置变化前在上一个位置停了多久（输出帧）。 */
    this.reached = 0
    this.held = 0
    this.lastArrival = undefined
    this.rest = undefined
    this.quantum = 0
    this.velocity = 0
    this.interval = sampleRate / 60
    this.offset = undefined
    this.offsetFrame = 0
    this.reportedAt = -Infinity
    this.frame = [0, 0]
    this.reference = new Float64Array(0)
    this.energies = new Float64Array(0)
    this.scratch = new Float64Array(0)
    this.port.onmessage = (event) => this.receive(event.data)
  }

  get base() { return this.sourceRate / sampleRate }

  /** 主线程事件时刻（performance.now 毫秒）换算到输出帧：取到达时刻差的最小值，去掉投递抖动，允许缓慢漂移。 */
  eventTime(at) {
    if (typeof at !== 'number' || !Number.isFinite(at)) return currentFrame
    const estimate = currentFrame - at * sampleRate / 1000
    this.offset = this.offset === undefined ? estimate : Math.min(estimate, this.offset + (currentFrame - this.offsetFrame) * 0.001)
    this.offsetFrame = currentFrame
    return at * sampleRate / 1000 + this.offset
  }

  receive(message) {
    switch (message.type) {
      case 'config': {
        if (message.key !== this.key || message.sampleRate !== this.sourceRate || message.blockFrames !== this.blockFrames || message.channels !== this.channels) {
          this.blocks.clear(); this.missed.clear()
        }
        this.key = message.key
        this.sourceRate = message.sampleRate
        this.channels = Math.max(1, Math.min(8, message.channels))
        this.blockFrames = message.blockFrames
        this.totalFrames = message.frames
        return
      }
      case 'block': {
        if (message.key !== this.key) return
        this.blocks.set(message.index, message.planes)
        this.missed.delete(message.index)
        this.evict()
        return
      }
      case 'rest': this.rest = message.position; if (this.mode === 'idle') this.lastPosition = message.position; return
      case 'move': return this.move(message.position, this.eventTime(message.at), message.quantum ?? 0)
      case 'step': return this.step(message.position, message.frames)
      case 'release': case 'stop': return this.silence()
      default:
    }
  }

  move(position, time, quantum) {
    if (this.lastArrival !== undefined) {
      const gap = time - this.lastArrival
      if (gap > 0 && gap < sampleRate * 0.12) this.interval += (gap - this.interval) * 0.2
    }
    this.lastArrival = time
    this.quantum = quantum
    if (this.mode !== 'drag' || time - this.lastTime > Math.max(2 * this.timing(this.velocity).stop, RESTART * sampleRate)) {
      const fresh = this.mode !== 'drag'
      if (this.mode === 'burst') { for (const segment of this.segments) segment.fadeTo(0, FADE_OUT); this.current = null }
      if (fresh) { this.direction = 0; this.edge = undefined }
      this.mode = 'drag'
      this.historyTime = []; this.historyPosition = []
      // 起点记在第一次变化之前一个事件间隔；按帧取整时第一次变化要等指针走过半帧，至少按原速走半帧的时间算。
      const origin = this.lastPosition ?? this.rest
      const start = time - Math.max(this.interval, this.quantum / 2 / this.base)
      // 新手势不沿用上一手势的到达时刻：否则第一次变化“在原位停了多久”会被算成上次手势至今，停住后拖尾很久才收声。
      // 同一手势里停顿后重新起步时保留，按住不动等帧变化的那段仍要算进去。
      if (fresh) this.reached = start
      if (origin !== undefined && origin !== position) this.record(start, origin)
    } else if (position === this.lastPosition) return
    else if (this.lastStep !== 0 && Math.sign(position - this.lastPosition) !== this.lastStep) {
      // 指针换了方向：速度从拐点重新估计，旧方向的样本不再拖慢换向。按帧取整时拐点的时刻不确定，
      // 至少按“原速度走一帧”的时间算，第一次反向变化来得快也不会估出离谱的高速。
      const turned = this.quantum > 0 && this.velocity !== 0 ? Math.min(this.lastTime, time - this.quantum / Math.abs(this.velocity)) : this.lastTime
      this.historyTime = [turned]; this.historyPosition = [this.lastPosition]
    }
    this.lastStep = this.lastPosition === undefined ? 0 : Math.sign(position - this.lastPosition)
    this.record(time, position)
  }

  record(time, position) {
    // 按帧取整（四舍五入）时帧一变就是指针越过了两帧中间：静止起点或换向拐点到第一次变化只走了半帧。
    // 这一段的起点按半帧挪向运动方向，否则第一下估出的速度偏快一倍。
    const times = this.historyTime, positions = this.historyPosition
    if (this.quantum > 0 && times.length === 1 && position !== positions[0] && Math.abs(position - positions[0]) <= 1.5 * this.quantum) {
      positions[0] += Math.sign(position - positions[0]) * this.quantum / 2
    }
    times.push(time); positions.push(position)
    if (position !== this.lastPosition) { this.held = time - this.reached; this.reached = time }
    this.lastPosition = position; this.lastTime = time
  }

  step(position, frames) {
    const current = this.current
    if (this.mode === 'burst' && current && current.fadeTarget > 0 && Math.abs(this.where(current) - position) <= STEP_JOIN * this.sourceRate) {
      current.end = Math.max(current.end, position + frames)
    } else {
      for (const segment of this.segments) segment.fadeTo(0, FADE_OUT)
      const segment = new Segment(this.align(position), position + frames)
      segment.fadeTo(1, STEP_ATTACK); segment.release = STEP_RELEASE
      this.segments.push(segment); this.current = segment
    }
    this.mode = 'burst'
    this.historyTime = []; this.historyPosition = []
    this.lastPosition = position; this.rest = position; this.lastStep = 0
  }

  silence() {
    for (const segment of this.segments) segment.fadeTo(0, FADE_OUT)
    this.current = null
    this.mode = 'idle'
    this.direction = 0; this.edge = undefined
    this.historyTime = []; this.historyPosition = []; this.lastStep = 0
    if (this.lastPosition !== undefined) this.rest = this.lastPosition
  }

  /** 当前速度下下一个位置预计多久到、再等多久开始收、多久收完（输出帧）。 */
  timing(velocity) {
    // 最近两次位置变化的间隔也算进来：减速时估计的速度偏快，按速度算的间隔偏短，会误判停住。
    const times = this.historyTime, last = times.length - 1
    const gap = last >= 1 ? times[last] - times[last - 1] : 0
    // 第一次变化前在原位停了多久，第二次变化也可能要等这么久：起步时估出的速度偏快，按它算会把慢拖误判成停住。
    const first = times.length === 2 ? this.held : 0
    const due = clamp(Math.max(this.interval, gap, first, this.quantum > 0 && velocity !== 0 ? this.quantum / Math.abs(velocity) : 0), 0.012 * sampleRate, DUE_MAX * sampleRate)
    // 按帧取整时，帧变化落在哪个指针事件上本身就差一个事件间隔：至少多等这么久才算迟到。
    const slack = due + Math.max(SLACK_FACTOR * due, SLACK_MIN * sampleRate, this.quantum > 0 ? QUANTUM_JITTER * this.interval : 0)
    return { due, slack, stop: slack + Math.max(STOP_FACTOR * due, STOP_MIN * sampleRate) }
  }

  /** 速度（源帧 / 输出帧）、指针位置估计（源帧）与跟随权重（1 = 还在动，0 = 已停住）。 */
  estimate(now) {
    const times = this.historyTime, positions = this.historyPosition
    while (times.length > 2 && times[0] < now - HISTORY * sampleRate) { times.shift(); positions.shift() }
    const last = times.length - 1
    let velocity = 0, meanTime = 0, meanPosition = 0
    if (last >= 1) {
      // 按帧取整时帧变化的时刻有一个事件间隔的抖动：多取几次变化（更长的窗口）平均掉。
      const quantized = this.quantum > 0
      const reach = quantized ? WINDOW_CHANGES_QUANTIZED : WINDOW_CHANGES
      const span = clamp(times[last] - times[Math.max(0, last - reach)], (quantized ? WINDOW_QUANTIZED : WINDOW_MIN) * sampleRate, (quantized ? WINDOW_MAX_QUANTIZED : WINDOW_MAX) * sampleRate)
      let first = last - 1
      while (first > 0 && times[last] - times[first - 1] <= span) first--
      for (let index = first; index <= last; index++) { meanTime += times[index]; meanPosition += positions[index] }
      const count = last - first + 1
      meanTime /= count; meanPosition /= count
      let numerator = 0, denominator = 0
      for (let index = first; index <= last; index++) { const dt = times[index] - meanTime; numerator += dt * (positions[index] - meanPosition); denominator += dt * dt }
      velocity = denominator > 0 ? numerator / denominator : 0
    }
    this.velocity = velocity
    const elapsed = Math.max(0, now - this.lastTime)
    const { due, slack, stop } = this.timing(velocity)
    // 位置按帧取整时，迟迟没到下一帧说明指针已经慢下来：速度不超过“一帧 ÷ 已等时间（扣掉一个事件间隔的抖动）”。
    const waited = elapsed - QUANTUM_JITTER * this.interval
    if (this.quantum > 0 && waited > 0) velocity = Math.sign(velocity) * Math.min(Math.abs(velocity), OVERDUE * this.quantum / waited)
    const weight = clamp((stop - elapsed) / (stop - slack), 0, 1)
    const latest = this.lastPosition ?? 0
    let position = latest + velocity * Math.min(elapsed, due) * weight
    if (this.quantum > 0 && last >= 1 && velocity !== 0) {
      // 帧变化落在哪个指针事件上有一个事件间隔的抖动：按最近几次变化的拟合直线定位，比只看最后一帧平滑。
      // 下一帧没到之前指针不会越过下一帧，所以沿直线外推最多到最后一帧前方一帧，也不落后它一帧以上。
      const onLine = meanPosition + velocity * (Math.min(now, this.lastTime + slack) - meanTime)
      position = clamp(onLine, latest - this.quantum, latest + this.quantum)
    }
    return { velocity: velocity * weight, position: clamp(position, 0, this.totalFrames), weight }
  }

  /** 一段此刻的源位置。 */
  where(segment) { return segment.start + segment.played * this.base }

  /** 同采样率时段起点取整到采样帧：原速片段逐样本复制，不插值。 */
  align(position) { return this.base === 1 ? Math.round(position) : position }

  /** 起一段（或一块）并让当前段在同一时刻、用同样时长淡出（交叉淡化，两段相加恒为 1）。 */
  begin(start, end, fade) {
    const previous = this.current
    if (previous && previous.fadeTarget > 0) previous.fadeTo(0, fade)
    const segment = new Segment(start, end)
    segment.fadeTo(1, fade)
    this.segments.push(segment); this.current = segment
    return segment
  }

  /** 让当前段淡出，不接新段。 */
  end(seconds = FADE_OUT) {
    if (this.current && this.current.fadeTarget > 0) this.current.fadeTo(0, seconds)
    this.current = null
  }

  /** 每个渲染量子开头：按指针位置决定接着放、停下、跳到指针处，或铺下一块倒拖的声音。 */
  follow(now) {
    const plan = this.plan = this.estimate(now)
    const base = this.base, speed = plan.velocity / base
    const pointer = plan.position
    const moving = plan.weight > 0 && Math.abs(speed) > STILL
    const direction = speed > TURN ? 1 : speed < -TURN ? -1 : this.direction
    if (direction !== this.direction) {
      // 换向：已放过的边界作废，正在放的那段很快淡出。
      if (this.direction !== 0) this.end()
      this.direction = direction; this.edge = undefined
    }
    const current = this.current
    if (this.direction >= 0) {
      const near = clamp((speed - 0.5) / 0.5, 0, 1) * clamp((2 - speed) / 0.5, 0, 1)
      const ahead = (AHEAD + (AHEAD_NEAR_UNIT - AHEAD) * near) * this.sourceRate
      if (current) {
        const x = this.where(current)
        // 停下的位置记在淡出结束处：接着放时不重放淡出的那几毫秒。
        if (!moving) { this.edge = x + FADE_OUT * this.sourceRate; this.end(); return }
        const behind = (BEHIND + (BEHIND_NEAR_UNIT - BEHIND) * near) * this.sourceRate
        if (x - pointer > ahead) { this.repeat(current, x, pointer); return }
        if (pointer - x > behind && current.played >= MIN_SEGMENT * sampleRate) this.begin(this.match(x, pointer), undefined, CROSSFADE)
        return
      }
      if (!moving || this.direction === 0) return
      const edge = this.edge
      // 停过又接着拖：指针在上次停下的位置附近就从那里接着放（已响过的不重放），否则从指针处放。
      const resume = edge !== undefined && pointer >= edge - Math.max(ahead, REPEAT_LIMIT * this.sourceRate) && pointer - edge <= BEHIND * this.sourceRate
      this.begin(this.align(resume ? edge : pointer), undefined, FADE_IN)
      return
    }
    // 向后拖：块按原速正着放，一块接一块沿指针往回铺；指针走到下一块中点才铺（已放过的不重放），跳得太远就以指针为中心。
    const chunk = CHUNK * this.sourceRate
    if (!moving) { this.end(); return }
    if (current && current.end !== undefined && this.where(current) < current.end - (CROSSFADE * sampleRate + 1) * base) return
    const edge = this.edge ?? pointer + chunk / 2
    if (pointer > edge - chunk / 2) { if (current) this.end(); return }
    const start = pointer < edge - 1.5 * chunk ? pointer - chunk / 2 : edge - chunk
    // 上一块还在响时两块交叉淡化，起点同样按波形对齐（只在 ±SEEK 内挪，块与块之间不留缝也不重放）。
    const from = current ? this.match(this.where(current), Math.max(0, start)) : this.align(Math.max(0, start))
    this.begin(from, from + chunk, current ? CROSSFADE : FADE_IN)
    this.edge = from
  }

  /**
   * 声音领先指针（慢拖）：往回接一小段，接缝按波形对齐。接上的位置不早于刚响过的音头的结束处，音头不重放；
   * 离可延长的稳定部分太近（刚过音头）就先接着放。
   */
  repeat(current, x, pointer) {
    if (current.played < REPEAT_GAP * sampleRate) return
    const rate = this.sourceRate, seek = REPEAT_SEEK * rate
    const far = x - pointer > REPEAT_LIMIT * rate
    const target = far ? pointer : Math.max(pointer, x - REPEAT * rate)
    let low = target - seek
    const high = Math.min(target + seek, x - REPEAT_MIN * rate)
    // 当前段淡出期间还会再响 REPEAT_CROSSFADE：这段里开始的音头也算已经响过。
    if (!far) { const attack = this.attackEnd(low, x + REPEAT_CROSSFADE * rate); if (attack !== undefined) low = Math.max(low, attack) }
    if (high < low) return
    this.begin(this.match(x, clamp(target, low, high), low, high, REPEAT_MATCH), undefined, REPEAT_CROSSFADE)
  }

  /**
   * 与 [low, high] 源帧范围重叠、且已经开始（早于 high）的音头里最晚的那个在哪里结束（源帧）；没有返回 undefined。
   * 窗口能量连续几跳超过前一窗口时取比值最大的一跳为音头，音头之后 ONSET_HOLD 内仍算音头（起音后的峰）。
   * 还没送来的声音按静音算（不判音头）。
   */
  attackEnd(low, high) {
    const hop = Math.max(1, Math.round(ONSET_HOP * this.sourceRate)), hold = ONSET_HOLD * this.sourceRate
    const first = Math.floor((low - hold) / hop) - ONSET_SPAN, last = Math.floor(high / hop) + ONSET_SPAN
    const origin = first - ONSET_SPAN, count = last - first + 2 * ONSET_SPAN
    const energies = this.energies.length >= count ? this.energies : (this.energies = new Float64Array(count))
    const samples = this.monoRange(origin * hop, count * hop)
    for (let index = 0, k = 0; index < count; index++) {
      let sum = 0
      for (const end = k + hop; k < end; k++) sum += samples[k] * samples[k]
      energies[index] = sum
    }
    let found, best = 0, attack = -1
    for (let hopIndex = first; hopIndex <= last + 1; hopIndex++) {
      let ratio = 0
      if (hopIndex <= last) {
        let now = 0, before = 0
        for (let offset = 0; offset < ONSET_SPAN; offset++) { now += energies[hopIndex - origin + offset]; before += energies[hopIndex - origin - 1 - offset] }
        if (now > ONSET_FLOOR * ONSET_SPAN * hop) ratio = now / (before + 1e-12)
      }
      if (ratio > ONSET_RATIO) { if (ratio > best) { best = ratio; attack = hopIndex } continue }
      if (attack >= 0 && attack * hop < high && (attack + 1) * hop + hold > low) found = (attack + 1) * hop + hold
      best = 0; attack = -1
    }
    return found
  }

  /**
   * 接到 target 附近：在 [low, high]（默认 ±SEEK）内找与“当前段接下来要放的那几毫秒”最相似的起点（归一化互相关），
   * 接缝两侧波形对齐，交叉淡化不出咔哒；搜索范围的声音还没送来时直接用 target。所有声道用同一个起点。
   */
  match(natural, target, low = target - SEEK * this.sourceRate, high = target + SEEK * this.sourceRate, seconds = CROSSFADE) {
    const length = Math.max(8, Math.round(seconds * this.sourceRate))
    const center = Math.round(target), from = Math.round(natural)
    const first = Math.min(center, Math.ceil(low)), last = Math.max(center, Math.floor(high))
    if (!this.covered(Math.min(from, first - 1), Math.max(from, last + 1) + length, false)) return this.align(target)
    const reference = this.reference.length >= length ? this.reference : (this.reference = new Float64Array(length))
    reference.set(this.monoRange(from, length).subarray(0, length))
    let referenceEnergy = 0
    for (let index = 0; index < length; index++) referenceEnergy += reference[index] * reference[index]
    if (referenceEnergy < 1e-12) return this.align(target)
    const window = this.monoRange(first, last - first + length)
    // 范围大时先隔 COARSE 个起点、隔一个样本粗找，再在最好的那个附近逐样本细找（只差几个样本，对齐效果相同，计算量约为六分之一）。
    const coarse = last - first > 8 * COARSE ? COARSE : 1
    let best = center, bestScore = -Infinity
    for (let start = first; start <= last; start += coarse) {
      const score = similarity(reference, window, start - first, length, coarse > 1 ? 2 : 1)
      if (score > bestScore) { bestScore = score; best = start }
    }
    if (coarse > 1) {
      const around = best
      bestScore = -Infinity
      for (let start = Math.max(first, around - coarse + 1); start <= Math.min(last, around + coarse - 1); start++) {
        const score = similarity(reference, window, start - first, length, 1)
        if (score > bestScore) { bestScore = score; best = start }
      }
    }
    return this.base === 1 ? best : best + (target - center)
  }

  /** 从整数源帧 from 起 count 帧的单声道值（接缝对齐与音头检测用），越界与缺块处为 0；返回复用的缓冲。 */
  monoRange(from, count) {
    const buffer = this.scratch.length >= count ? this.scratch : (this.scratch = new Float64Array(Math.max(count, 2 * this.scratch.length)))
    const block = this.blockFrames, total = this.totalFrames, stereo = this.channels > 1
    let index = 0, k = from
    while (index < count) {
      if (k < 0 || k >= total) {
        const run = k < 0 ? Math.min(count - index, -k) : count - index
        buffer.fill(0, index, index + run); index += run; k += run; continue
      }
      const blockIndex = Math.floor(k / block), offset = k - blockIndex * block
      const run = Math.min(count - index, block - offset, total - k), planes = this.blocks.get(blockIndex)
      if (!planes) buffer.fill(0, index, index + run)
      else if (stereo) { const a = planes[0], b = planes[1]; for (let i = 0; i < run; i++) buffer[index + i] = (a[offset + i] + b[offset + i]) / 2 }
      else { const a = planes[0]; for (let i = 0; i < run; i++) buffer[index + i] = a[offset + i] }
      index += run; k += run
    }
    return buffer
  }

  has(index) { return index < 0 || index * this.blockFrames >= this.totalFrames || this.blocks.has(index) }

  /** [low, high] 源帧范围的块是否都在；缺的报给主线程（每块只报一次）。 */
  covered(low, high, report = true) {
    const first = Math.floor(low / this.blockFrames), last = Math.floor(high / this.blockFrames)
    let ok = true
    for (let index = first; index <= last; index++) {
      if (this.has(index)) continue
      ok = false
      if (report && !this.missed.has(index)) { this.missed.add(index); this.port.postMessage({ type: 'miss', index }) }
    }
    return ok
  }

  /** 读源位置 x 的一帧到 this.frame：同采样率直接取样（各声道同一位置），否则按固定比例带限插值。 */
  read(x) {
    const frame = this.frame
    const block = this.blockFrames, total = this.totalFrames, second = this.channels > 1 ? 1 : 0
    if (this.base === 1) {
      if (x < 0 || x >= total) { frame[0] = frame[1] = 0; return }
      const index = Math.floor(x / block), planes = this.blocks.get(index)
      if (!planes) { frame[0] = frame[1] = 0; return }
      const offset = x - index * block
      frame[0] = planes[0][offset]; frame[1] = planes[second][offset]
      return
    }
    const scale = this.base > 1 ? 1 / this.base : 1
    const first = Math.floor(x - ZEROS / scale) + 1, last = Math.floor(x + ZEROS / scale)
    let sum0 = 0, sum1 = 0, weights = 0
    for (let k = first; k <= last; k++) {
      const distance = (x - k) * scale
      const position = (distance < 0 ? -distance : distance) * RESOLUTION
      const cell = position | 0
      if (cell >= TABLE_SIZE) continue
      const weight = TABLE[cell] + (position - cell) * (TABLE[cell + 1] - TABLE[cell])
      weights += weight
      if (k < 0 || k >= total) continue
      const index = Math.floor(k / block), planes = this.blocks.get(index)
      if (!planes) continue
      const offset = k - index * block
      sum0 += weight * planes[0][offset]; sum1 += weight * planes[second][offset]
    }
    frame[0] = weights > 0 ? sum0 / weights : 0; frame[1] = weights > 0 ? sum1 / weights : 0
  }

  evict() {
    if (this.blocks.size <= MAX_BLOCKS) return
    const center = Math.floor((this.current ? this.where(this.current) : this.lastPosition ?? 0) / this.blockFrames)
    const evicted = []
    while (this.blocks.size > MAX_BLOCKS) {
      let farthest, distance = -1
      for (const index of this.blocks.keys()) { const d = Math.abs(index - center); if (d > distance) { distance = d; farthest = index } }
      this.blocks.delete(farthest); evicted.push(farthest)
    }
    this.port.postMessage({ type: 'evicted', indices: evicted })
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output?.length) return true
    const frames = output[0].length
    const left = output[0], right = output.length > 1 ? output[1] : undefined
    left.fill(0); if (right) right.fill(0)
    if (this.mode === 'drag') this.follow(currentFrame)
    const base = this.base
    const reach = base === 1 ? 1 : ZEROS / Math.min(1, 1 / base) + 2
    // 每段这一量子要读的范围（加上淡出所需的提前量）都在才发声，否则先淡出。
    for (const segment of this.segments) {
      const from = this.where(segment)
      segment.availTarget = this.covered(from - reach, from + (frames + MISSING_FADE * sampleRate) * base + reach) ? 1 : 0
    }
    const availStep = 1 / (MISSING_FADE * sampleRate)
    const frame = this.frame
    for (let index = 0; index < frames; index++) {
      for (const segment of this.segments) {
        if (segment.fade !== segment.fadeTarget) segment.fade = segment.fade < segment.fadeTarget ? Math.min(segment.fadeTarget, segment.fade + segment.fadeStep) : Math.max(segment.fadeTarget, segment.fade - segment.fadeStep)
        if (segment.avail !== segment.availTarget) segment.avail = segment.avail < segment.availTarget ? Math.min(1, segment.avail + availStep) : Math.max(0, segment.avail - availStep)
        const x = this.where(segment)
        // 有终点的段（单步、倒拖块）在终点前淡出。
        if (segment.end !== undefined && segment.fadeTarget > 0 && x >= segment.end - segment.release * this.sourceRate) segment.fadeTo(0, segment.release)
        segment.played++
        const fade = segment.fade, avail = segment.avail
        if (fade <= 0 || avail <= 0) continue
        // 升余弦包络：一进一出的两段相加恒为 1，接缝处电平不变。
        const envelope = (fade >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * fade)) * (avail >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * avail))
        this.read(x)
        left[index] += frame[0] * envelope
        if (right) right[index] += frame[1] * envelope
      }
    }
    this.segments = this.segments.filter(segment => segment.fade > 0 || segment.fadeTarget > 0)
    if (this.current && !this.segments.includes(this.current)) { this.current = null; if (this.mode === 'burst') this.mode = 'idle' }
    if (this.segments.length && currentFrame - this.reportedAt >= REPORT * sampleRate) {
      this.reportedAt = currentFrame
      const current = this.current
      this.port.postMessage({ type: 'head', position: current ? this.where(current) : this.edge ?? this.lastPosition ?? 0, speed: this.mode === 'burst' ? 1 : this.plan.velocity / base })
    }
    return true
  }
}

registerProcessor('henji-audio-scrub', HenjiAudioScrubProcessor)
