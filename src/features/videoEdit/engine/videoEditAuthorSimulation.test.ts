import { describe, expect, it, vi } from 'vitest'
import { CODE_AUTHOR_SIMULATION_MIN_API_VERSION, codeSimulationIdentity, codeSimulationPosition, codeSimulationSourceTime, copySimulationData, simulationView, type AuthorSimulation, type CodeSimulationInput, type SimulationData } from '@/core/videoEdit/codeSimulation'
import { AuthorSimulationBudget, VideoEditAuthorSimulation, type AuthorSimulationFactory } from './videoEditAuthorSimulation'
import { authorEffectMetadata } from './videoEditAuthorParameters'
import { fingerprintAuthorSimulation } from './videoEditAuthorFingerprint'
import { prepareCodeMaterialParameters, evaluateCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug() {}, warn() {} }) }))
const size = { width: 1920, height: 1080 }
const input: CodeSimulationInput = { identity: 'same', parametersAt: () => ({ force: 1 }) }
function particle(counters = { steps: 0, disposed: 0 }): AuthorSimulationFactory {
  return () => {
    let x = 0, velocity = 0, births: number[] = []
    return {
      step(params, info) {
        velocity += Number(params.force) * info.dt
        x += velocity * info.dt + info.random() * .0001 + Math.random() * .0001
        if (info.step % 11 === 0) births.push(info.step)
        if (info.step % 17 === 0) births = births.slice(1)
        counters.steps++
      },
      snapshot: () => ({ x, velocity, births: [...births] }),
      restore(snapshot) { const state = snapshot as { x: number; velocity: number; births: number[] }; x = state.x; velocity = state.velocity; births = state.births },
      read: () => ({ x, births: Float64Array.from(births) }),
      dispose() { counters.disposed++ },
    }
  }
}
const prepare = (simulation: VideoEditAuthorSimulation, time: number, options: Partial<CodeSimulationInput> = {}) => simulation.prepare({ start: time, end: time, center: time, input: { ...input, ...options } })

describe('固定步模拟', () => {
  it('顺序、乱序、冷跳、恢复和交错实例逐字节相同，视图与世界分离且同一时刻复用', async () => {
    const count = { steps: 0, disposed: 0 }, sequential = new VideoEditAuthorSimulation(particle(), undefined, size, 'same')
    const shuffled = new VideoEditAuthorSimulation(particle(count), undefined, size, 'same')
    const reference = new Map<number, Readonly<SimulationData>>()
    for (const time of [0, .5, .999, 1, 1.001, 1.5, 2]) reference.set(time, (await prepare(sequential, time)).at(time))
    for (const time of [2, 1, .5, 1.5, 0, 1.001, .999, 2]) {
      const sampler = await prepare(shuffled, time)
      expect(sampler.at(time)).toEqual(reference.get(time))
      const view = sampler.at(time) as { x: number; births: Float64Array }
      expect(Object.isFrozen(view)).toBe(true)
      expect(sampler.at(time)).toBe(view)
      const steps = count.steps
      expect((await prepare(shuffled, time)).at(time)).toEqual(reference.get(time))
      expect(count.steps).toBe(steps)
    }
    expect(shuffled.lastPreparation!.replaySteps).toBe(0)
    await sequential.dispose(); await shuffled.dispose()
    expect(count.disposed).toBe(1)
  })

  it('插值和乱序曝光查询只读本帧视图，旧帧观察不受后续推进影响', async () => {
    let steps = 0
    const simulation = new VideoEditAuthorSimulation(() => {
      let x = 0
      return { step() { x++; steps++ }, snapshot: () => x, restore: state => { x = state as number }, read: () => ({ x }),
        interpolate: (left, right, alpha) => ({ x: (left as { x: number }).x * (1 - alpha) + (right as { x: number }).x * alpha }), dispose() {} }
    }, undefined, size, 'same', 2)
    const view = await simulation.prepare({ start: -.1, end: .03, center: 0, input })
    const before = steps
    for (const t of [.025, .015, -.03, 0, .025]) expect((view.at(t) as { x: number }).x).toBeCloseTo(Math.max(0, t) * 120, 12)
    expect(steps).toBe(before)
    expect(() => view.at(.1)).toThrow('曝光范围')
    const next = await simulation.prepare({ start: 1.99, end: 2.1, center: 2, input })
    expect(next.at(2.1)).toEqual({ x: 240 })
    expect(view.at(.025)).toEqual({ x: 3 })
    await simulation.dispose()
  })

  it('完整参数历史参与积分与身份，目标帧参数相同也不能复用状态', async () => {
    const metadata = authorEffectMetadata({ name: 'history', params: [{ key: 'force', type: 'number', default: 1, min: 0, max: 10, step: .01, animatable: true }], draw() {} })
    const make = (first: number) => prepareCodeMaterialParameters({ ...metadata, seed: 0 }, { parameters: {}, curves: { force: [
      { id: 'a', ...codeSimulationSourceTime(0, 120), value: first, interpolation: 'linear' },
      { id: 'b', ...codeSimulationSourceTime(120, 120), value: 1, interpolation: 'linear' },
    ] } })
    const a = make(1), b = make(4)
    expect(evaluateCodeMaterialParameters(a, codeSimulationSourceTime(240, 120))).toEqual(evaluateCodeMaterialParameters(b, codeSimulationSourceTime(240, 120)))
    const first = new VideoEditAuthorSimulation(particle(), undefined, size, 'same'), second = new VideoEditAuthorSimulation(particle(), undefined, size, 'same')
    const x = (await prepare(first, 2, { parametersAt: (step, rate) => evaluateCodeMaterialParameters(a, codeSimulationSourceTime(step, rate)) })).at(2)
    const y = (await prepare(second, 2, { parametersAt: (step, rate) => evaluateCodeMaterialParameters(b, codeSimulationSourceTime(step, rate)) })).at(2)
    expect(x).not.toEqual(y)
    expect(codeSimulationIdentity('source', [...a.curves], size)).not.toBe(codeSimulationIdentity('source', [...b.curves], size))
    await first.dispose(); await second.dispose()
  })

  it('检查点预算共享淘汰、S0 超预算和取消后的恢复均保持结果', async () => {
    const budget = new AuthorSimulationBudget(400)
    const a = new VideoEditAuthorSimulation(particle(), { snapshotEvery: 12 }, size, 'same', undefined, budget)
    const b = new VideoEditAuthorSimulation(particle(), undefined, size, 'same', undefined, budget)
    const expected = (await prepare(a, 3)).at(3)
    await prepare(b, 2)
    expect(budget.evictions).toBeGreaterThan(0)
    expect((await prepare(a, 3)).at(3)).toEqual(expected)
    await prepare(a, 0)
    const controller = new AbortController()
    const pending = prepare(a, 60, { signal: controller.signal })
    setTimeout(() => controller.abort(), 0)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect((await prepare(a, 3)).at(3)).toEqual(expected)
    await a.dispose(); await b.dispose(); expect(budget.bytes).toBe(0)
    const tiny = new AuthorSimulationBudget(1), large = new VideoEditAuthorSimulation(particle(), undefined, size, 'same', undefined, tiny)
    await prepare(large, 0); expect(tiny.excessReason).toBe('initial-snapshots')
    await large.dispose(); expect(tiny.bytes).toBe(0)
  })

  it('失败废弃半步世界，释放等待异步初始化，不发布过期结果', async () => {
    let fail = true, disposed = 0, created = 0
    const simulation = new VideoEditAuthorSimulation(() => {
      created++; let value = 0
      return { step() { value++; if (fail && value === 2) { fail = false; throw new Error('half step') } }, snapshot: () => value, restore: state => { value = state as number }, read: () => value, dispose() { disposed++ } }
    }, undefined, size, 'same')
    await expect(prepare(simulation, .1)).rejects.toThrow('half step')
    expect((await prepare(simulation, .1)).at(.1)).toBe(12)
    expect(created).toBe(2); expect(disposed).toBe(1)
    await simulation.dispose()
    let release!: (world: AuthorSimulation) => void
    const delayed = new VideoEditAuthorSimulation(() => new Promise(resolve => { release = resolve }), undefined, size, 'same')
    const pending = prepare(delayed, 1)
    await Promise.resolve()
    const closing = delayed.dispose(), dispose = vi.fn()
    release({ step() {}, snapshot: () => 0, restore() {}, read: () => 0, dispose })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await closing
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('精确源时刻与浮点边界一致，旧 API 忽略同名属性，指纹不调用作者函数', () => {
    for (const step of [0, 1, 119, 120, 240, 1000001]) {
      expect(codeSimulationPosition(codeSimulationSourceTime(step, 120), 120)).toEqual({ step, alpha: 0 })
      expect(codeSimulationPosition(step / 120, 120)).toEqual({ step, alpha: 0 })
    }
    const effect = { name: 'simulation', mode: 'static' as const, createSimulation: particle(), draw: vi.fn(), frameKey: vi.fn(() => 0) }
    expect(authorEffectMetadata(effect, 7).simulation).toBeUndefined()
    expect(() => authorEffectMetadata(effect, CODE_AUTHOR_SIMULATION_MIN_API_VERSION)).toThrow('static')
    const frame = (time: number) => fingerprintAuthorSimulation(effect, 'epoch', size, { time, frameDuration: 1 / 60, clip: { time, duration: 2 } }, {}, {}, undefined, true, {})
    expect(frame(0).digest).not.toBe(frame(1).digest)
    expect(effect.frameKey).not.toHaveBeenCalled(); expect(effect.draw).not.toHaveBeenCalled()
    expect(() => copySimulationData(new Date() as unknown as SimulationData)).toThrow('序列化')
    expect(simulationView(Array.from({ length: 200_000 }, (_, i) => i))).toHaveLength(200_000)
  })

  it('异步初始化中取消后，完整 S0 支持下一帧继续运行', async () => {
    let release!: (world: AuthorSimulation) => void
    const factory = vi.fn(() => new Promise<AuthorSimulation>(resolve => { release = resolve }))
    const simulation = new VideoEditAuthorSimulation(factory, undefined, size, 'same')
    const controller = new AbortController(), pending = prepare(simulation, 1, { signal: controller.signal })
    await Promise.resolve(); controller.abort()
    let value = 0
    release({ step() { value++ }, snapshot: () => value, restore(state) { value = state as number }, read: () => value, dispose() {} })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect((await prepare(simulation, 1)).at(1)).toBe(120)
    expect(factory).toHaveBeenCalledOnce()
    await simulation.dispose()
  })

  it('seed 隔离随机轨迹，restore 失败释放世界后可从 S0 正确重算', async () => {
    const a = new VideoEditAuthorSimulation(particle(), { seed: 1 }, size, 'same')
    const b = new VideoEditAuthorSimulation(particle(), { seed: 2 }, size, 'same')
    expect((await prepare(a, 2)).at(2)).not.toEqual((await prepare(b, 2)).at(2))
    const factory = particle(), disposed = vi.fn(); let fail = true
    const broken = new VideoEditAuthorSimulation((params, width, height, info) => {
      const world = factory(params, width, height, info) as AuthorSimulation
      return { ...world, restore(state) { if (fail) { fail = false; throw new Error('restore failure') } world.restore(state) }, dispose() { world.dispose(); disposed() } }
    }, { seed: 1 }, size, 'same')
    await prepare(broken, 2)
    await expect(prepare(broken, .5)).rejects.toThrow('restore failure')
    expect(disposed).toHaveBeenCalledOnce()
    expect((await prepare(broken, .5)).at(.5)).toEqual((await prepare(a, .5)).at(.5))
    await a.dispose(); await b.dispose(); await broken.dispose()
  })
  it.each([25, 50])('插值顺播 %s fps 只推进差值步数，同刻插值只执行一次', async fps => {
    let steps = 0, restores = 0, interpolations = 0, snapshots = 0
    const simulation = new VideoEditAuthorSimulation(() => {
      let x = 0
      return { step() { x++; steps++ }, snapshot() { snapshots++; return x }, restore(state) { restores++; x = state as number }, read: () => ({ x }),
        interpolate(left, right, alpha) { interpolations++; return { x: (left as { x: number }).x * (1 - alpha) + (right as { x: number }).x * alpha } }, dispose() {} }
    }, undefined, size, 'same')
    try {
      for (let frame = 0; frame <= fps; frame++) {
        const time = frame / fps, sampler = await prepare(simulation, time)
        const view = sampler.at(time), count = interpolations
        for (let i = 0; i < 100; i++) expect(sampler.at(time)).toBe(view)
        expect(interpolations).toBe(count)
        expect((view as { x: number }).x).toBeCloseTo(time * 120, 10)
        expect(steps).toBe(Math.max(0, Math.ceil(time * 120 - 1e-10)))
      }
      expect(restores).toBe(0)
      await prepare(simulation, 0)
      expect(snapshots).toBe(2)
    } finally { await simulation.dispose() }
  })

  it('插值失败后重建世界，随后取消不污染下一次准备', async () => {
    let created = 0, disposed = 0, fail = true
    const simulation = new VideoEditAuthorSimulation(() => {
      created++; let value = 0
      return { step() { value++ }, snapshot: () => value, restore(state) { value = state as number }, read: () => value,
        interpolate(left, right, alpha) { if (fail) { fail = false; throw new Error('interpolate failure') } return Number(left) * (1 - alpha) + Number(right) * alpha }, dispose() { disposed++ } }
    }, undefined, size, 'same')
    try {
      const sampler = await prepare(simulation, .011)
      expect(() => sampler.at(.011)).toThrow('interpolate failure')
      expect((await prepare(simulation, .011)).at(.011)).toBeCloseTo(1.32)
      expect(created).toBe(2); expect(disposed).toBe(1)
      const controller = new AbortController(), pending = prepare(simulation, 60, { signal: controller.signal })
      setTimeout(() => controller.abort(), 0)
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      expect((await prepare(simulation, .011)).at(.011)).toBeCloseTo(1.32)
      expect(created).toBe(2); expect(disposed).toBe(1)
    } finally { await simulation.dispose() }
  })

  it.each([[NaN, 'NaN'], [Infinity, 'Infinity'], [undefined, 'undefined']] as const)('非法快照值 %s 返回准确诊断', (value, message) => {
    expect(() => copySimulationData({ nested: value } as SimulationData)).toThrow(message)
  })

})
