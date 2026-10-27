import { createLogger } from '@/core/logging'

/**
 * 擦洗音频（拖动播放头试听）的唯一实现：剪辑节目监视器、源监视器与音频编辑都用它。
 *
 * - 声音在音频线程里由 audioScrubWorklet.js 播放：始终是原速、原音高、原电平的原声片段，跟着指针走（向前接着放、
 *   向后一块块往回铺），停住即收声，单步播放一小段原速声音。指针位置一到就交给音频线程，不等画面、不等混音。
 * - 主线程只负责按块（AUDIO_SCRUB_BLOCK_SECONDS）向声音来源要声音并送进音频线程：按下时先取指针附近，拖动中按方向与速度
 *   往前多取；同一份来源已取的块一直留着（音频线程按距离淘汰），反复拖同一段不再重混。
 * - 声音来源由宿主提供（剪辑按序列混音、音频编辑按试听模式拼接）；来源对象换了就是另一份声音，旧块全部作废。
 */

const logger = createLogger('services.audioScrub')

/** 声音块长度（秒）：剪辑混音每次有约 20–30ms 固定开销，块太短开销占比大，太长第一声等得久。 */
export const AUDIO_SCRUB_BLOCK_SECONDS = 0.25
/** 单步（方向键、逐帧）播放的原速声音长度（秒）。 */
export const AUDIO_SCRUB_STEP_SECONDS = 0.1
const PROCESSOR = 'henji-audio-scrub'
/** 读取失败的块过这么久才重试，避免坏位置被反复请求。 */
const RETRY_MS = 500
/** 处理器加载完成前排队的控制消息上限。 */
const QUEUE_LIMIT = 256

export interface AudioScrubSource {
  readonly sampleRate: number
  readonly channels: number
  /** 声音总长（采样帧）。 */
  readonly frames: number
  /** 读 [start, start + frames) 采样帧，按声道返回；越界部分补零。 */
  read(start: number, frames: number): Promise<Float32Array[]>
  /** 同时在读的请求数上限，默认 1（剪辑混音在渲染会话里本来就串行）。 */
  readonly concurrency?: number
}

export interface AudioScrubOutput {
  readonly context: BaseAudioContext
  readonly destination: AudioNode
}

export interface AudioScrubMoveOptions {
  /** 宿主给出的位置按多长取整（秒）：剪辑按帧取整时传一帧时长，读头据此判断指针是否慢下来或停住。 */
  quantum?: number
  /** 事件发生的时刻（performance.now 毫秒）；宿主转手调用时传原始时刻，默认现在。 */
  at?: number
}

type WorkletMessage =
  | { type: 'head'; position: number; speed: number }
  | { type: 'miss'; index: number }
  | { type: 'evicted'; indices: number[] }

interface SessionStats { moves: number; steps: number; reads: number; readMs: number; slowestReadMs: number; misses: number; failures: number }
const emptyStats = (): SessionStats => ({ moves: 0, steps: 0, reads: 0, readMs: 0, slowestReadMs: 0, misses: 0, failures: 0 })

const modules = new WeakMap<BaseAudioContext, Promise<void>>()
function loadProcessor(context: BaseAudioContext): Promise<void> {
  let pending = modules.get(context)
  if (!pending) {
    const loading = context.audioWorklet.addModule(new URL('./audioScrubWorklet.js', import.meta.url).href)
    loading.catch(() => { if (modules.get(context) === loading) modules.delete(context) })
    modules.set(context, pending = loading)
  }
  return pending
}

/**
 * 读头附近要备好的块，按优先级：目标与读头所在块，沿运动方向往前（够读头在“0.5 秒 + 三倍读取耗时”里走完，速度越快、
 * 读取越慢取得越远），最后往回一两块（反向拖动）。
 */
export function audioScrubWantedBlocks(head: number, target: number, speed: number, blockFrames: number, totalBlocks: number, readSecondsPerBlock: number): number[] {
  const direction = speed < -0.05 ? -1 : 1
  const center = Math.floor(head / blockFrames)
  const aheadSeconds = 0.4 + Math.abs(speed) * (0.5 + 3 * readSecondsPerBlock)
  const ahead = Math.min(16, Math.max(2, Math.ceil(aheadSeconds / AUDIO_SCRUB_BLOCK_SECONDS)))
  const order = [Math.floor(target / blockFrames), center]
  for (let step = 1; step <= ahead; step++) order.push(center + direction * step)
  order.push(center - direction, center - 2 * direction)
  const seen = new Set<number>()
  return order.filter(index => {
    if (index < 0 || index >= totalBlocks || seen.has(index)) return false
    seen.add(index)
    return true
  })
}

export class AudioScrubEngine {
  private output?: AudioScrubOutput
  private node?: AudioWorkletNode
  private attaching?: Promise<void>
  private queued: Array<{ message: object; transfer: Transferable[] }> = []
  private source?: AudioScrubSource
  private sourceKey = 0
  private blockFrames = 1
  private readonly loaded = new Set<number>()
  private readonly reading = new Set<number>()
  private readonly failed = new Map<number, number>()
  private inFlight = 0
  private head?: number
  private target?: number
  private speed = 0
  private readSecondsPerBlock = 0.03
  private active = false
  private disposed = false
  private stats = emptyStats()

  constructor(private readonly options: { onError?: (error: unknown) => void } = {}) {}

  /** 接到一个输出（换音频设备或换总线时重新接）；处理器加载完成前的操作按顺序排队。 */
  attach(output: AudioScrubOutput): void {
    if (this.disposed) return
    const previous = this.output
    if (previous?.context === output.context && previous.destination === output.destination) return
    this.output = output
    if (previous?.context === output.context) {
      if (this.node) { this.node.disconnect(); this.node.connect(output.destination) }
      return
    }
    if (this.node) {
      // 换了音频设备：新的音频线程里没有任何块，按当前来源重新配置、重新取。
      this.node.port.onmessage = null; this.node.disconnect(); this.node = undefined
      this.loaded.clear(); this.reading.clear(); this.inFlight = 0; this.sourceKey++; this.queued = []
      this.configure()
    }
    const context = output.context
    const attaching: Promise<void> = loadProcessor(context).then(() => {
      if (this.disposed || this.attaching !== attaching) return
      const node = new AudioWorkletNode(context, PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
      node.port.onmessage = (event: MessageEvent<WorkletMessage>) => this.receive(event.data)
      node.connect(output.destination)
      this.node = node
      this.attaching = undefined
      const queued = this.queued
      this.queued = []
      for (const { message, transfer } of queued) node.port.postMessage(message, transfer)
      this.pump()
    }).catch((error: unknown) => {
      if (this.attaching !== attaching) return
      this.attaching = undefined
      logger.warn('擦洗声音处理器加载失败', { event: 'audio_scrub.processor.failed', error })
      this.options.onError?.(error)
    })
    this.attaching = attaching
    this.pump()
  }

  /** 换声音来源；同一个对象不重复配置。旧来源的块与在途读取全部作废。 */
  setSource(source: AudioScrubSource | undefined): void {
    if (source === this.source || this.disposed) return
    this.source = source
    this.sourceKey++
    this.loaded.clear(); this.reading.clear(); this.failed.clear(); this.inFlight = 0
    this.head = this.target = undefined
    this.configure()
  }

  get currentSource(): AudioScrubSource | undefined { return this.source }

  /** 指针按下或拖动起点：记下静止位置并先取附近的声音，第一下拖动就能出声。 */
  rest(seconds: number): void {
    const position = this.position(seconds)
    if (position === undefined) return
    this.target = this.head = position
    this.post({ type: 'rest', position })
    this.pump()
  }

  /** 拖动到 seconds（不必按帧取整；按帧取整时用 quantum 告知取整长度）。 */
  move(seconds: number, options: AudioScrubMoveOptions = {}): void {
    const position = this.position(seconds)
    if (position === undefined) return
    this.begin()
    this.stats.moves++
    this.target = position
    this.post({ type: 'move', position, at: options.at ?? performance.now(), quantum: (options.quantum ?? 0) * this.source!.sampleRate })
    this.pump()
  }

  /** 单步：从 seconds 起播放一小段原速声音；接连单步且位置接得上时连续播放。 */
  step(seconds: number, durationSeconds = AUDIO_SCRUB_STEP_SECONDS): void {
    const position = this.position(seconds)
    if (position === undefined) return
    this.begin()
    this.stats.steps++
    this.target = this.head = position
    this.speed = 1
    this.post({ type: 'step', position, frames: Math.round(durationSeconds * this.source!.sampleRate) })
    this.pump()
  }

  /** 松手或停止试听：很快淡出静音；已取的声音保留给下一次拖动。没有在试听时什么也不做（宿主可以随手调用）。 */
  stop(): void {
    if (!this.active) return
    this.finish()
    this.post({ type: 'stop' })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.stop()
    this.disposed = true
    const node = this.node
    this.node = undefined; this.attaching = undefined; this.queued = []; this.source = undefined; this.output = undefined
    if (!node) return
    // 留出淡出时间再断开，避免截断成咔哒声。
    await new Promise(resolve => setTimeout(resolve, 15))
    node.port.onmessage = null
    node.disconnect()
  }

  private position(seconds: number): number | undefined {
    const source = this.source
    if (!source || this.disposed || !Number.isFinite(seconds)) return undefined
    return Math.max(0, Math.min(source.frames, seconds * source.sampleRate))
  }

  private begin(): void {
    if (this.active) return
    this.active = true
    this.stats = emptyStats()
    logger.debug('擦洗试听开始', { event: 'audio_scrub.session.start', context: { sampleRate: this.source?.sampleRate, frames: this.source?.frames } })
  }

  private finish(): void {
    this.active = false
    const { moves, steps, reads, readMs, slowestReadMs, misses, failures } = this.stats
    logger.debug('擦洗试听结束', { event: 'audio_scrub.session.completed', context: { moves, steps, reads, meanReadMs: reads ? Math.round(readMs / reads) : 0, slowestReadMs: Math.round(slowestReadMs), misses, failures } })
  }

  private configure(): void {
    const source = this.source
    if (!source) return
    this.blockFrames = Math.max(1, Math.round(AUDIO_SCRUB_BLOCK_SECONDS * source.sampleRate))
    this.post({ type: 'config', key: this.sourceKey, sampleRate: source.sampleRate, channels: source.channels, blockFrames: this.blockFrames, frames: source.frames })
  }

  private post(message: object, transfer: Transferable[] = []): void {
    if (this.disposed) return
    if (this.node) { this.node.port.postMessage(message, transfer); return }
    this.queued.push({ message, transfer })
    if (this.queued.length > QUEUE_LIMIT) this.queued.splice(this.queued.findIndex(entry => (entry.message as { type: string }).type !== 'config'), 1)
  }

  private receive(message: WorkletMessage): void {
    if (message.type === 'head') { this.head = message.position; this.speed = message.speed; this.pump() }
    else if (message.type === 'miss') { this.stats.misses++; this.pump() }
    else if (message.type === 'evicted') for (const index of message.indices) this.loaded.delete(index)
  }

  /** 按优先级补读缺的块；读取要在接上输出后才开始（没地方放的声音不读）。 */
  private pump(): void {
    const source = this.source
    if (!source || this.target === undefined || !this.output || this.disposed) return
    const limit = Math.max(1, source.concurrency ?? 1)
    const totalBlocks = Math.ceil(source.frames / this.blockFrames)
    const now = performance.now()
    const missing = audioScrubWantedBlocks(this.head ?? this.target, this.target, this.speed, this.blockFrames, totalBlocks, this.readSecondsPerBlock)
      .filter(index => !this.loaded.has(index) && !this.reading.has(index) && (this.failed.get(index) ?? 0) <= now)
    while (this.inFlight < limit && missing.length) {
      const first = missing.shift()!
      // 沿运动方向相邻的缺块合成一次读取（剪辑混音连续读比分开读便宜得多）；还没有任何块时第一块单独读，第一声不等。
      let low = first, high = first
      const run = this.loaded.size === 0 ? 1 : this.readSecondsPerBlock > 0.06 ? 4 : 3
      while (high - low + 1 < run && (missing[0] === high + 1 || missing[0] === low - 1)) {
        const next = missing.shift()!
        if (next === high + 1) high = next
        else low = next
      }
      this.read(low, high)
    }
  }

  private read(low: number, high: number): void {
    const source = this.source!
    const key = this.sourceKey
    const blockFrames = this.blockFrames
    const start = low * blockFrames
    const frames = Math.min(source.frames, (high + 1) * blockFrames) - start
    for (let index = low; index <= high; index++) this.reading.add(index)
    this.inFlight++
    const began = performance.now()
    this.stats.reads++
    void source.read(start, frames).then(planes => {
      if (key !== this.sourceKey || !planes.length) return
      const elapsed = performance.now() - began
      this.readSecondsPerBlock += (elapsed / 1000 / (high - low + 1) - this.readSecondsPerBlock) * 0.3
      this.stats.readMs += elapsed
      this.stats.slowestReadMs = Math.max(this.stats.slowestReadMs, elapsed)
      for (let index = low; index <= high; index++) {
        const offset = (index - low) * blockFrames
        const block = Array.from({ length: source.channels }, (_, channel) => {
          const plane = planes[Math.min(channel, planes.length - 1)]
          const copy = new Float32Array(blockFrames)
          copy.set(plane.subarray(Math.min(plane.length, offset), Math.min(plane.length, offset + blockFrames)))
          return copy
        })
        this.post({ type: 'block', key, index, planes: block }, block.map(plane => plane.buffer))
        this.loaded.add(index)
        this.failed.delete(index)
      }
    }).catch((error: unknown) => {
      if (key !== this.sourceKey) return
      this.stats.failures++
      for (let index = low; index <= high; index++) this.failed.set(index, performance.now() + RETRY_MS)
      logger.warn('擦洗声音读取失败', { event: 'audio_scrub.read.failed', error, context: { start, frames } })
      this.options.onError?.(error)
    }).finally(() => {
      if (key !== this.sourceKey) return
      this.inFlight--
      for (let index = low; index <= high; index++) this.reading.delete(index)
      this.pump()
    })
  }
}
