import { authorLayerId } from './videoEditAuthorElements'
import type { AuthorLayer, AuthorModule, AuthorWebGL, AuthorWebGPU } from './videoEditAuthorModule'

/**
 * 同一参数、同一时刻必须得到同一画面：预渲染按源码与参数寻址，播放、预渲染、导出各自加载模块，作者代码用了
 * 不带种子的随机数或真实时钟，缓存画面就会和实时画面对不上。作者函数执行期间 Math.random 换成按（入口、时刻）
 * 定种子的序列，Date.now / performance.now 换成由时刻推出的值；离开作者函数立即换回。
 * 异步入口只覆盖到第一个 await 之前；`new Date()` 不拦。
 */
export function runAuthorDeterministic<T>(key: string, time: number | undefined, call: () => T): T {
  const timing = globalThis.performance
  const random = Math.random, dateNow = Date.now, ownNow = Object.hasOwn(timing, 'now'), now = timing.now
  const ms = Number.isFinite(time) ? time! * 1000 : 0
  Math.random = seededRandom(key, time)
  Date.now = () => Math.floor(ms)
  timing.now = () => ms
  try { return call() } finally {
    Math.random = random; Date.now = dateNow
    if (ownNow) timing.now = now; else delete (timing as { now?: unknown }).now
  }
}

/** FNV-1a 混入入口名与微秒时刻，再用 mulberry32 展开；同一入口同一时刻每次都是同一串数。 */
export function seededRandom(key: string, time: number | undefined): () => number {
  let hash = 0x811c9dc5
  const mix = (value: number): void => { hash = Math.imul(hash ^ value, 0x01000193) }
  for (let index = 0; index < key.length; index++) mix(key.charCodeAt(index))
  const micros = Number.isFinite(time) ? Math.round(time! * 1e6) : 0
  mix(micros | 0); mix(Math.floor(micros / 4294967296) | 0)
  let state = hash >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

let imports: Promise<unknown> = Promise.resolve()
/**
 * 模块顶层代码在 import 时执行一次，播放与预渲染各加载一份：顶层随机数也要相同。一次只加载一个模块，
 * 加载期间 Math.random 固定种子；时钟照常（同一 Worker 里的计时与缓存时效还在用）。
 */
export function importAuthorDeterministic<T>(load: () => Promise<T>): Promise<T> {
  const result = imports.then(async () => {
    const random = Math.random
    Math.random = seededRandom('module', 0)
    try { return await load() } finally { Math.random = random }
  })
  imports = result.catch(() => undefined)
  return result
}

/*
 * 包装的是浅拷贝：宿主本来就会展开图层对象，作者也可能冻结常量图层，代理会撞上不可改属性的约束。
 * 方法仍以原对象为 this 调用，作者存在 this 上的状态照常可用。
 */

function deterministicLayer(layer: AuthorLayer, index: number): AuthorLayer {
  if (!layer || typeof layer !== 'object' || typeof layer.draw !== 'function') return layer
  const key = authorLayerId(layer, index), draw = layer.draw, pose = layer.pose
  return {
    ...layer,
    draw: (ctx, time) => runAuthorDeterministic(`draw:${key}`, time, () => draw.call(layer, ctx, time)),
    ...(typeof pose === 'function' ? { pose: (time: number) => runAuthorDeterministic(`pose:${key}`, time, () => pose.call(layer, time)) } : {}),
  }
}

function deterministicWebGL(webgl: AuthorWebGL): AuthorWebGL {
  if (!webgl || typeof webgl !== 'object' || typeof webgl.draw !== 'function') return webgl
  const { draw, dispose } = webgl
  return {
    ...webgl,
    draw: (...args) => runAuthorDeterministic('webgl', args[0], () => draw.apply(webgl, args)),
    ...(typeof dispose === 'function' ? { dispose: () => dispose.call(webgl) } : {}),
  }
}

function deterministicWebGPU(webgpu: AuthorWebGPU): AuthorWebGPU {
  if (!webgpu || typeof webgpu !== 'object' || typeof webgpu.draw !== 'function') return webgpu
  const { draw, dispose } = webgpu
  return {
    ...webgpu,
    draw: (...args) => runAuthorDeterministic('webgpu', args[1], () => draw.apply(webgpu, args)),
    ...(typeof dispose === 'function' ? { dispose: () => dispose.call(webgpu) } : {}),
  }
}

/** 作者模块的每个入口都经 runAuthorDeterministic 执行；layers() 返回的图层与 GPU 入口返回的绘制对象同样包装。 */
export function deterministicAuthorModule(effect: AuthorModule): AuthorModule {
  const { draw, layers, createWebGL, createWebGPU, dispose } = effect
  return {
    ...effect,
    ...(typeof draw === 'function' ? { draw: (...args: Parameters<typeof draw>) => runAuthorDeterministic('draw', args[1], () => draw.apply(effect, args)) } : {}),
    ...(typeof layers === 'function' ? { layers: (...args: Parameters<typeof layers>) => {
      const list = runAuthorDeterministic('layers', args[4]?.time, () => layers.apply(effect, args))
      return Array.isArray(list) ? list.map(deterministicLayer) : list
    } } : {}),
    ...(typeof createWebGL === 'function' ? { createWebGL: (gl: WebGL2RenderingContext) => deterministicWebGL(runAuthorDeterministic('create', 0, () => createWebGL.call(effect, gl))) } : {}),
    ...(typeof createWebGPU === 'function' ? { createWebGPU: async (device: Parameters<typeof createWebGPU>[0]) => deterministicWebGPU(await runAuthorDeterministic('create', 0, () => createWebGPU.call(effect, device))) } : {}),
    ...(typeof dispose === 'function' ? { dispose: () => dispose.call(effect) } : {}),
  }
}
