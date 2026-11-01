import { createLogger } from '@/core/logging'
import { CODE_SIMULATION_CACHE_BYTES, codeSimulationDeclaration, codeSimulationPosition, copySimulationData, simulationDataBytes, simulationView, type AuthorSimulation, type AuthorSimulationDeclaration, type AuthorSimulationInfo, type AuthorSimulationSampler, type CodeSimulationInput, type SimulationData } from '@/core/videoEdit/codeSimulation'
import { runAuthorDeterministic, seededRandom } from './videoEditAuthorDeterminism'

const logger = createLogger('features.videoEdit.authorSimulation')
interface Checkpoint { step: number; data: SimulationData; bytes: number; evict(): void }

/** Worker 内所有作者实例共用；S0 计入诊断，但不会被 LRU 淘汰。 */
export class AuthorSimulationBudget {
  private readonly lru = new Set<Checkpoint>()
  private pinnedBytes = 0
  private cachedBytes = 0
  evictions = 0
  constructor(readonly limit = CODE_SIMULATION_CACHE_BYTES) {}
  get bytes(): number { return this.pinnedBytes + this.cachedBytes }
  get excessReason(): string | undefined { return this.bytes > this.limit ? 'initial-snapshots' : undefined }
  pin(bytes: number): void { this.pinnedBytes += bytes; this.trim() }
  unpin(bytes: number): void { this.pinnedBytes -= bytes }
  add(checkpoint: Checkpoint): void { this.lru.add(checkpoint); this.cachedBytes += checkpoint.bytes; this.trim() }
  touch(checkpoint: Checkpoint): void { if (this.lru.delete(checkpoint)) this.lru.add(checkpoint) }
  remove(checkpoint: Checkpoint): void { if (this.lru.delete(checkpoint)) this.cachedBytes -= checkpoint.bytes }
  private trim(): void {
    while (this.bytes > this.limit && this.lru.size) {
      const entry = this.lru.values().next().value!
      this.remove(entry); entry.evict(); this.evictions++
    }
  }
}
const workerBudget = new AuthorSimulationBudget()

export type AuthorSimulationFactory = (params: Readonly<Record<string, unknown>>, width: number, height: number, info: AuthorSimulationInfo) => AuthorSimulation | Promise<AuthorSimulation>
export interface SimulationPreparation {
  start: number; end: number; center: number
  input: CodeSimulationInput
}

/** 一帧的取样器持有独立视图，观察旧帧时不会读到已推进的世界。 */
export class VideoEditAuthorSimulation {
  private world?: AuthorSimulation
  private poisoned = false
  private current = 0
  private initial?: Checkpoint
  private readonly checkpoints = new Map<number, Checkpoint>()
  private readonly steps: number[] = []
  private views = new Map<number, Readonly<SimulationData>>()
  private closed = false
  private queue: Promise<unknown> = Promise.resolve()
  private closing?: Promise<void>
  readonly declaration: Required<AuthorSimulationDeclaration>
  private interpolates?: boolean
  lastPreparation?: { restoredStep: number; replaySteps: number; checkpointBytes: number; elapsedMs: number; evictions: number }

  constructor(private readonly factory: AuthorSimulationFactory, declaration: AuthorSimulationDeclaration | undefined,
    private readonly size: { width: number; height: number }, readonly identity: string,
    private readonly duration?: number, private readonly budget = workerBudget) {
    this.declaration = codeSimulationDeclaration(declaration)
  }
  private info(step: number, phase: string): AuthorSimulationInfo {
    const { rate, seed } = this.declaration
    return { step, time: step / rate, dt: 1 / rate, random: seededRandom(`simulation:${seed}:${phase}:${step}`, 0) }
  }
  private call<T>(step: number, phase: string, action: (info: AuthorSimulationInfo) => T): T {
    const info = this.info(step, phase)
    try { return runAuthorDeterministic(`simulation:${this.declaration.seed}:${phase}:${step}`, info.time, () => action(info), info.random) }
    catch (error) { this.poisoned = true; throw error }
  }
  private check(input: CodeSimulationInput): void {
    if (this.closed || input.signal?.aborted) throw new DOMException('模拟准备已取消。', 'AbortError')
    input.assertCurrent?.()
    if (input.identity !== this.identity) throw new DOMException('模拟输入已变化。', 'AbortError')
  }
  private clamp(time: number): number {
    if (!Number.isFinite(time)) throw new Error('模拟取样时刻必须是有限数。')
    return Math.max(0, Math.min(time, this.duration ?? Infinity))
  }
  private save(): void {
    if (this.current === 0 ? this.initial : this.checkpoints.has(this.current)) return
    const snapshot = this.call(this.current, 'snapshot', () => this.world!.snapshot())
    const bytes = simulationDataBytes(snapshot), data = structuredClone(snapshot)
    const step = this.current
    const checkpoint: Checkpoint = { step, data, bytes, evict: () => {
      this.checkpoints.delete(step)
      const index = this.index(step)
      if (this.steps[index] === step) this.steps.splice(index, 1)
    } }
    if (step === 0) {
      if (!this.initial) { this.initial = checkpoint; this.budget.pin(checkpoint.bytes) }
    } else {
      this.checkpoints.set(step, checkpoint); this.steps.splice(this.index(step), 0, step); this.budget.add(checkpoint)
    }
  }
  private index(step: number): number {
    let left = 0, right = this.steps.length
    while (left < right) { const middle = Math.floor((left + right) / 2); if (this.steps[middle] < step) left = middle + 1; else right = middle }
    return left
  }
  private predecessor(step: number): Checkpoint {
    const index = this.index(step)
    return this.checkpoints.get(this.steps[this.steps[index] === step ? index : index - 1]) ?? this.initial!
  }
  private synchronous<T>(value: T): T {
    if (value && typeof value === 'object' && 'then' in value) throw new Error('模拟 step、snapshot、restore、read 和 interpolate 必须同步。')
    return value
  }
  private async initialize(input: CodeSimulationInput): Promise<void> {
    if (this.world) return
    this.poisoned = false
    const world = await this.call(0, 'init', info => this.factory(input.parametersAt(0, this.declaration.rate), this.size.width, this.size.height, info))
    this.world = world
    for (const method of ['step', 'snapshot', 'restore', 'read', 'dispose'] as const) if (typeof world?.[method] !== 'function') throw new Error(`createSimulation 需要提供 ${method}()。`)
    if (world.interpolate !== undefined && typeof world.interpolate !== 'function') throw new Error('simulation.interpolate 必须是函数。')
    this.interpolates = typeof world.interpolate === 'function'
    this.current = 0
    this.save()
    this.check(input)
  }
  prepare(request: SimulationPreparation): Promise<AuthorSimulationSampler> {
    const result = this.queue.then(() => this.prepareFrame(request))
    this.queue = result.catch(() => undefined)
    return result
  }
  private async prepareFrame({ start, end, center, input }: SimulationPreparation): Promise<AuthorSimulationSampler> {
    const started = performance.now(), evictions = this.budget.evictions
    this.check(input)
    logger.debug('开始准备模拟画面', { event: 'video_edit.simulation.prepare.start', context: { ...input.owner, epoch: this.identity, targetTime: center } })
    try {
      if (this.poisoned) {
        const world = this.world; this.world = undefined; this.views.clear()
        this.poisoned = false
        world?.dispose()
      }
      await this.initialize(input)
      const rate = this.declaration.rate
      const position = (time: number): ReturnType<typeof codeSimulationPosition> => codeSimulationPosition(
        time === center && input.sourceTime && this.clamp(time) === time ? input.sourceTime : this.clamp(time), rate)
      const first = position(Math.min(start, center)), last = position(Math.max(end, center))
      const a = first.step, b = last.step + (this.interpolates && last.alpha > 0 ? 1 : 0)
      const views = new Map<number, Readonly<SimulationData>>()
      for (let n = a; n <= b; n++) { const view = this.views.get(n); if (view !== undefined) views.set(n, view) }
      let replaySteps = 0, restoredStep = this.current
      if (views.size !== b - a + 1) {
        const checkpoint = this.predecessor(a)
        let missingBeforeCurrent = false
        for (let n = a; n < this.current && n <= b; n++) if (!views.has(n)) { missingBeforeCurrent = true; break }
        if (missingBeforeCurrent || this.current < checkpoint.step) {
          this.call(checkpoint.step, 'restore', () => this.synchronous(this.world!.restore(copySimulationData(checkpoint.data))))
          this.current = checkpoint.step; this.budget.touch(checkpoint)
        }
        restoredStep = this.current
        let batchStart = performance.now(), batchSteps = 0
        while (this.current <= b) {
          this.check(input)
          if (this.current >= a && !views.has(this.current)) views.set(this.current, simulationView(this.call(this.current, 'read', () => this.world!.read())))
          if (this.current === b) break
          this.call(this.current, 'step', info => this.synchronous(this.world!.step(input.parametersAt(info.step, rate), info)))
          this.current++; replaySteps++; batchSteps++
          if (this.current % this.declaration.snapshotEvery === 0) this.save()
          if (batchSteps >= 32 || performance.now() - batchStart >= 4) {
            await new Promise<void>(resolve => setTimeout(resolve, 0))
            this.check(input); batchStart = performance.now(); batchSteps = 0
          }
        }
      }
      this.check(input)
      this.views = views
      // 视图在准备时复制并冻结一次；同一时刻的插值结果由本帧取样器复用。
      const interpolate = this.world!.interpolate?.bind(this.world), low = this.clamp(Math.min(start, center)), high = this.clamp(Math.max(end, center))
      const samples = new Map<number, Readonly<SimulationData>>()
      const sampler: AuthorSimulationSampler = { at: time => {
        const clamped = this.clamp(time), tolerance = Number.EPSILON * Math.max(1, Math.abs(clamped), high) * 8
        if (clamped < low - tolerance || clamped > high + tolerance) throw new Error(`simulation.at(${time}) 超出当前帧准备的曝光范围 [${low}, ${high}]。`)
        const { step, alpha } = position(time), left = views.get(step)
        if (left === undefined) throw new Error('模拟取样缺少已准备的完整步。')
        if (!interpolate || alpha === 0) return left
        if (samples.has(clamped)) return samples.get(clamped)!
        const right = views.get(step + 1)
        if (right === undefined) throw new Error('模拟插值缺少右侧完整步。')
        const sample = this.call(step, 'interpolate', () => simulationView(interpolate(left, right, alpha)))
        samples.set(clamped, sample)
        return sample
      } }
      this.lastPreparation = { restoredStep, replaySteps, checkpointBytes: this.budget.bytes, elapsedMs: performance.now() - started, evictions: this.budget.evictions - evictions }
      logger.debug('模拟画面准备完成', { event: 'video_edit.simulation.prepare.completed', context: { ...input.owner, epoch: this.identity, ...this.lastPreparation, excessReason: this.budget.excessReason } })
      return sampler
    } catch (error) {
      // 取消只发生在完整步之间；作者抛错可能留下半步状态，必须重建活动世界。
      const cancelled = error instanceof Error && error.name === 'AbortError'
      if (this.poisoned || !cancelled) {
        const world = this.world; this.world = undefined; this.views.clear(); this.poisoned = false
        try { world?.dispose?.() } catch (disposeError) { throw new AggregateError([error, disposeError], '模拟失败且资源释放失败。') }
      }
      logger[cancelled ? 'debug' : 'warn']('模拟画面准备失败或取消', { event: 'video_edit.simulation.prepare.failed', context: { ...input.owner, epoch: this.identity, cancelled }, error })
      throw error
    }
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = this.queue.then(() => {
      const world = this.world; this.world = undefined; this.views.clear()
      for (const checkpoint of this.checkpoints.values()) this.budget.remove(checkpoint)
      this.checkpoints.clear(); this.steps.length = 0
      if (this.initial) this.budget.unpin(this.initial.bytes)
      this.initial = undefined
      world?.dispose?.()
    })
    return this.closing
  }
}
