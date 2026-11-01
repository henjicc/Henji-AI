import { afterAll, beforeAll, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import { CODE_AUTHOR_SIMULATION_MIN_API_VERSION, type AuthorSimulation, type SimulationData } from '@/core/videoEdit/codeSimulation'
import type { AuthorModule } from './videoEditAuthorModule'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { AuthorSimulationBudget, VideoEditAuthorSimulation } from './videoEditAuthorSimulation'
interface RapierWorld {
  timestep: number
  createCollider(shape: unknown, body?: unknown): unknown
  createRigidBody(description: unknown): { handle: number }
  getRigidBody(handle: number): unknown
  removeRigidBody(body: unknown): void
  step(): void
  takeSnapshot(): Uint8Array
  free(): void
}
interface Rapier {
  init(): Promise<void>
  World: { new(gravity: { x: number; y: number; z: number }): RapierWorld; restoreSnapshot(bytes: Uint8Array): RapierWorld }
  ColliderDesc: { cuboid(x: number, y: number, z: number): unknown; ball(radius: number): unknown }
  RigidBodyDesc: { dynamic(): { setTranslation(x: number, y: number, z: number): unknown } }
}

let gpu: Gpu
beforeAll(async () => { gpu = await init() })
afterAll(() => gpu?.dispose())

it('真实 GPU 作者入口在乱序、多实例、不同输出尺寸和帧率下保持同一模拟结果', async () => {
  const device = gpu.gpu
  const states: number[] = [], sizes: number[][] = []
  const effect: AuthorModule = {
    name: '模拟像素',
    createSimulation(_params, width, height) {
      sizes.push([width, height]); let x = 0
      return { step(_params, info) { x += info.dt }, snapshot: () => x, restore: state => { x = state as number }, read: () => x, dispose() {} }
    },
    createWebGPU() {
      return { draw(target, time, _params, _width, _height, _assets, info) {
        const x = Number(info.simulation!.at(time)); states.push(x)
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView() as ReturnType<ReturnType<typeof device.createTexture>['createView']>, loadOp: 'clear', storeOp: 'store', clearValue: { r: x / 4, g: .25, b: .5, a: 1 } }] })
        pass.end(); device.queue.submit([encoder.finish()])
      } }
    },
  }
  const a = new VideoEditAuthorRuntime(device as unknown as GpuDevice, effect, undefined, true, CODE_AUTHOR_SIMULATION_MIN_API_VERSION)
  const b = new VideoEditAuthorRuntime(device as unknown as GpuDevice, effect, undefined, true, CODE_AUTHOR_SIMULATION_MIN_API_VERSION)
  const texture = device.createTexture({ size: [32, 32], format: 'rgba8unorm', usage: 0x01 | 0x10 })
  const buffer = device.createBuffer({ size: 256 * 32, usage: 0x01 | 0x08 })
  const pixels = async (): Promise<Uint8Array> => {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, [32, 32])
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
    const bytes = new Uint8Array(buffer.getMappedRange().slice(0)); buffer.unmap(); return bytes
  }
  device.pushErrorScope('validation')
  try {
    const reference = new Map<number, Uint8Array>()
    for (const [runtime, rate, times] of [[a, 60, [0, .5, 1, 2]], [b, 24, [2, 1, 0, .5]], [b, 30, [1, 2, .5]], [a, 30000 / 1001, [1, .5, 2]]] as const) {
      for (const time of times) {
        await runtime.render(texture, 1920, 1080, {}, {}, { time, frameDuration: 1 / rate, clip: { time, duration: 4 } }, undefined, undefined, false, { width: 32, height: 32 })
        const bytes = await pixels()
        if (reference.has(time)) expect(bytes).toEqual(reference.get(time))
        else reference.set(time, bytes)
        expect(states.at(-1)).toBeCloseTo(time, 12)
      }
    }
    expect(sizes).toEqual([[1920, 1080], [1920, 1080]])
    for (const direction of [1, -1] as const) {
      const time = 3600 + .5 * direction
      await b.render(texture, 1920, 1080, {}, {}, { time, frameDuration: 1 / 50, clip: { time: .5, duration: 4 } }, undefined, undefined, false, { width: 32, height: 32 }, {}, 'interactive', () => {}, undefined,
        { identity: `filter-${direction}`, parametersAt: () => ({}), sourceTime: { sourceInUs: 500_000, sourceRemainder: { numerator: 0, denominator: 1 } }, sourceOrigin: { sourceInUs: 3_600_000_000, sourceRemainder: { numerator: 0, denominator: 1 } }, sourceDirection: direction })
      expect(states.at(-1)).toBeCloseTo(.5, 12)
      expect(await pixels()).toEqual(reference.get(.5))
    }
    expect(await device.popErrorScope()).toBeNull()
  } finally { await a.dispose(); await b.dispose(); buffer.destroy(); texture.destroy() }
})

it('冻结 Rapier 离线初始化去重，恢复与独立实例的最终世界字节一致', async () => {
  const module = await import(/* @vite-ignore */ pathToFileURL(path.resolve('resources/video-edit-author/frozen/@dimforge/rapier3d-deterministic-compat/0.21.0-henji.1/rapier.mjs')).href) as { default: Rapier; init: Rapier['init'] }
  expect(module.init).toBe(module.default.init)
  const ready = module.init(); expect(module.init()).toBe(ready); await ready
  const rapier = module.default
  const factory = (): AuthorSimulation => {
    let world = new rapier.World({ x: 0, y: -9.81, z: 0 })
    let step = 0, addedHandle: number | null = null
    world.timestep = 1 / 120
    world.createCollider(rapier.ColliderDesc.cuboid(20, .1, 20))
    for (let i = 0; i < 100; i++) {
      const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation((i % 10) * .6, 2 + Math.floor(i / 10) * .6, 0))
      world.createCollider(rapier.ColliderDesc.ball(.2), body)
    }
    return { step() {
      if (step === 90) {
        const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 12, 0))
        world.createCollider(rapier.ColliderDesc.ball(.3), body); addedHandle = body.handle
      }
      if (step === 150 && addedHandle !== null) { world.removeRigidBody(world.getRigidBody(addedHandle)); addedHandle = null }
      world.step(); step++
    }, snapshot: () => ({ bytes: world.takeSnapshot(), step, addedHandle }), restore(state) {
      const snapshot = state as { bytes: Uint8Array; step: number; addedHandle: number | null }
      const restored = rapier.World.restoreSnapshot(snapshot.bytes); restored.timestep = 1 / 120; world.free(); world = restored
      step = snapshot.step; addedHandle = snapshot.addedHandle
    }, read: () => world.takeSnapshot(), dispose() { world.free() } }
  }
  const budget = new AuthorSimulationBudget(400_000)
  const a = new VideoEditAuthorSimulation(factory, undefined, { width: 1920, height: 1080 }, 'rapier', undefined, budget)
  const b = new VideoEditAuthorSimulation(factory, undefined, { width: 1920, height: 1080 }, 'rapier', undefined, budget)
  const at = async (simulation: VideoEditAuthorSimulation, time: number): Promise<Readonly<SimulationData>> =>
    (await simulation.prepare({ start: time, end: time, center: time, input: { identity: 'rapier', parametersAt: () => ({}) } })).at(time)
  try {
    const reference = await at(a, 2)
    await at(a, 1)
    expect(await at(a, 1.75)).toEqual(await at(b, 1.75))
    expect(await at(a, 2)).toEqual(reference)
    expect(await at(b, 2)).toEqual(reference)
    expect(budget.evictions).toBeGreaterThan(0)
  } finally { await a.dispose(); await b.dispose() }
  expect(budget.bytes).toBe(0)
}, 30_000)
