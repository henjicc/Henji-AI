/* global sampleRate, currentFrame */
/**
 * 擦洗音频（拖动播放头试听）处理器：剪辑节目、源监视器与音频编辑共用，主线程入口见 audioScrubEngine.ts。
 *
 * 声音始终是原声：原速、原音高、原电平，多声道用同一位置、同一接缝、同一包络，不做变速、时间伸缩或任何平滑处理。
 * 拖动时按指针位置放一段段原速声音（Premiere 的做法），只在必要时用几毫秒的淡入淡出接缝：
 * - 向前拖：从指针处起按原速连续播放。声音跑到指针前面超过 AHEAD 就淡出停下，等指针追上停下的位置再从那里接着放
 *   （慢拖是一段段干脆的原速声音，不重复、不叠在一起）；落后指针超过 BEHIND 就跳到指针处，3ms 交叉淡化，
 *   接缝在 ±SEEK 内按波形相似度对齐（快拖是一段段跟着指针的原速片段）。按原速拖动时就是连续播放，输出与原声逐样本相同。
 * - 向后拖：一块块原速声音沿指针往回铺（每块 CHUNK 长、正着放），已经放过的地方不再重放。
 * - 停住即收声；单步播放一小段原速声音。
 * - 轨迹：主线程逐次送来指针位置与事件时刻。按最近几次位置变化做最小二乘求速度与位置，超过预期间隔没有新位置就视为停住。
 * - 声音由主线程按固定长度的块提前送来；将要读到缺块的位置时先淡出为静音，块到了再淡入。
 *
 * 位置都以源采样帧计；时间以输出采样帧计。源与输出采样率不同时按固定比例带限插值（不改变音高）。
 */
/**
 * 向前拖时声音最多领先指针、最多落后指针多少（秒），按拖动速度自适应：慢拖时领先一小段就停（干脆的原速片段），
 * 接近原速时放宽，手速的自然起伏不会把连续的声音切碎；快拖时落后一点就跳到指针处。跳之前当前段至少放 MIN_SEGMENT。
 */
const AHEAD = 0.06
const AHEAD_NEAR_UNIT = 0.09
const BEHIND = 0.03
const BEHIND_NEAR_UNIT = 0.05
const MIN_SEGMENT = 0.04
/** 指针离停下的位置还差这么多时就提前接着放（秒），抵消淡入时间。 */
const ANTICIPATE = 0.003
/** 向后拖时每块的长度（秒）。 */
const CHUNK = 0.05
/** 淡入、淡出、接缝交叉淡化时长（秒）与接缝对齐的搜索范围。 */
const FADE_IN = 0.002
const FADE_OUT = 0.003
const CROSSFADE = 0.003
const SEEK = 0.003
const MISSING_FADE = 0.003
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
    this.window = new Float64Array(0)
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
      if (this.mode === 'burst') { for (const segment of this.segments) segment.fadeTo(0, FADE_OUT); this.current = null }
      if (this.mode !== 'drag') { this.direction = 0; this.edge = undefined }
      this.mode = 'drag'
      this.historyTime = []; this.historyPosition = []
      // 起点记在第一次变化之前一个事件间隔；按帧取整时第一次变化要等指针走过半帧，至少按原速走半帧的时间算。
      const origin = this.lastPosition ?? this.rest
      if (origin !== undefined && origin !== position) this.record(time - Math.max(this.interval, this.quantum / 2 / this.base), origin)
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
    const due = clamp(Math.max(this.interval, gap, this.quantum > 0 && velocity !== 0 ? this.quantum / Math.abs(velocity) : 0), 0.012 * sampleRate, 0.12 * sampleRate)
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

  /** 起一段（或一块）并让当前段在同一时刻淡出（交叉淡化）。 */
  begin(start, end, fadeIn) {
    const previous = this.current
    if (previous && previous.fadeTarget > 0) previous.fadeTo(0, CROSSFADE)
    const segment = new Segment(start, end)
    segment.fadeTo(1, fadeIn)
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
      if (current) {
        const x = this.where(current)
        // 停下的位置记在淡出结束处：接着放时不重放淡出的那几毫秒。
        const near = clamp((speed - 0.5) / 0.5, 0, 1) * clamp((2 - speed) / 0.5, 0, 1)
        const ahead = (AHEAD + (AHEAD_NEAR_UNIT - AHEAD) * near) * this.sourceRate
        const behind = (BEHIND + (BEHIND_NEAR_UNIT - BEHIND) * near) * this.sourceRate
        if (!moving || x - pointer > ahead) { this.edge = x + FADE_OUT * this.sourceRate; this.end(); return }
        if (pointer - x > behind && current.played >= MIN_SEGMENT * sampleRate) this.begin(this.match(x, pointer), undefined, CROSSFADE)
        return
      }
      if (!moving || this.direction === 0) return
      const edge = this.edge
      // 指针追到上次停下的位置就从那里接着放；追过头太多（快拖）就从指针处放。
      if (edge !== undefined && pointer < edge - ANTICIPATE * this.sourceRate) return
      const start = edge !== undefined && pointer - edge <= BEHIND * this.sourceRate ? edge : pointer
      this.begin(this.align(start), undefined, FADE_IN)
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
   * 跳到 target 附近：在 ±SEEK 内找与“当前段接下来要放的那几毫秒”最相似的起点（归一化互相关），接缝两侧波形对齐，
   * 3ms 交叉淡化不出咔哒；搜索范围的声音还没送来时直接用 target。所有声道用同一个起点。
   */
  match(natural, target) {
    const seek = Math.round(SEEK * this.sourceRate), length = Math.max(8, Math.round(CROSSFADE * this.sourceRate))
    const center = Math.round(target), from = Math.round(natural)
    if (!this.covered(Math.min(from, center - seek - 1), Math.max(from, center + seek + 1) + length, false)) return this.align(target)
    const reference = this.reference.length >= length ? this.reference : (this.reference = new Float64Array(length))
    let referenceEnergy = 0
    for (let index = 0; index < length; index++) { const value = this.mono(from + index); reference[index] = value; referenceEnergy += value * value }
    if (referenceEnergy < 1e-12) return this.align(target)
    const origin = center - seek, span = 2 * seek + 1 + length
    const window = this.window.length >= span ? this.window : (this.window = new Float64Array(span))
    for (let index = 0; index < span; index++) window[index] = this.mono(origin + index)
    let best = center, bestScore = -Infinity
    for (let start = center - seek; start <= center + seek; start++) {
      let product = 0, energy = 0
      for (let index = 0, offset = start - origin; index < length; index++, offset++) { const value = window[offset]; product += reference[index] * value; energy += value * value }
      const score = energy > 1e-12 ? product / Math.sqrt(energy * referenceEnergy) : 0
      if (score > bestScore) { bestScore = score; best = start }
    }
    return this.base === 1 ? best : best + (target - center)
  }

  /** 整数源帧的单声道值（接缝对齐用）。 */
  mono(k) {
    if (k < 0 || k >= this.totalFrames) return 0
    const index = Math.floor(k / this.blockFrames), planes = this.blocks.get(index)
    if (!planes) return 0
    const offset = k - index * this.blockFrames
    return this.channels > 1 ? (planes[0][offset] + planes[1][offset]) / 2 : planes[0][offset]
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
