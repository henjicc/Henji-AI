import { withTextFontSession, importWithTextFontSession, resolvedTextFontSession } from '@/core/imaging/vectorContent/shaping/fontContext'
import type { TextFontAccess } from '@/core/imaging/vectorContent/shaping/fontSession'
import { CODE_AUTHOR_API_MIN_VERSION, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { authorLayerId } from './videoEditAuthorElements'
import { authorFillLayer } from './videoEditAuthorFill'
import type { AuthorLayer, AuthorModule, AuthorWebGL, AuthorWebGPU } from './videoEditAuthorModule'
import { TEXT_LAYOUT_OBSERVER, type TextLayoutObserverGlobal } from '../../../core/videoEdit/textDrawObservation'

/**
 * 同一参数、同一时刻必须得到同一画面：预渲染按源码与参数寻址，播放、预渲染、导出各自加载模块，作者代码用了
 * 不带种子的随机数或真实时钟，缓存画面就会和实时画面对不上。作者函数执行期间 Math.random 换成按（入口、时刻）
 * 定种子的序列，Date.now / performance.now 换成由时刻推出的值；离开作者函数立即换回。
 * 异步入口只覆盖到第一个 await 之前；`new Date()` 不拦。
 */
export function runAuthorDeterministic<T>(key: string, time: number | undefined, call: () => T, explicitRandom?: () => number): T {
  const timing = globalThis.performance
  const random = Math.random, dateNow = Date.now, ownNow = Object.hasOwn(timing, 'now'), now = timing.now
  const ms = Number.isFinite(time) ? time! * 1000 : 0
  Math.random = explicitRandom ?? seededRandom(key, time)
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

let asynchronousCalls: Promise<unknown> = Promise.resolve()
function serialized<T>(call: () => Promise<T>): Promise<T> {
  const result = asynchronousCalls.then(call)
  asynchronousCalls = result.catch(() => undefined)
  return result
}
/**
 * 模块顶层代码在 import 时执行一次，播放与预渲染各加载一份：顶层随机数也要相同。一次只加载一个模块，
 * 加载期间 Math.random 固定种子；时钟照常（同一 Worker 里的计时与缓存时效还在用）。
 */
export function importAuthorDeterministic<T>(load: () => Promise<T>, observeLayout?: (id: string) => void, fonts?: TextFontAccess): Promise<T> {
  return serialized(async () => {
    const random = Math.random
    const host = globalThis as TextLayoutObserverGlobal, previous = host[TEXT_LAYOUT_OBSERVER]
    host[TEXT_LAYOUT_OBSERVER] = observeLayout
    Math.random = seededRandom('module', 0)
    try { return await importWithTextFontSession(fonts, load) } finally { Math.random = random; host[TEXT_LAYOUT_OBSERVER] = previous }
  })
}

/*
 * 包装的是浅拷贝：宿主本来就会展开图层对象，作者也可能冻结常量图层，代理会撞上不可改属性的约束。
 * 方法仍以原对象为 this 调用，作者存在 this 上的状态照常可用。
 */

function authorCall<T>(fonts: TextFontAccess | undefined, key: string, time: number | undefined, call: () => T): T {
  return withTextFontSession(resolvedTextFontSession(fonts), () => runAuthorDeterministic(key, time, call))
}

/** 异步作者入口与模块求值共用队列，跨 await 保留本次参数的字体，不能串到别的模块。 */
function authorAsync<T>(fonts: TextFontAccess | undefined, key: string, time: number | undefined, call: () => T | Promise<T>): Promise<T> {
  if (!fonts) return Promise.resolve(runAuthorDeterministic(key, time, call))
  const prepared = resolvedTextFontSession(fonts)
  return serialized(() => importWithTextFontSession(prepared, async () => runAuthorDeterministic(key, time, call)))
}

function deterministicLayer(source: AuthorLayer, index: number, apiVersion: number, width: number, height: number, fonts?: TextFontAccess): AuthorLayer {
  if (!source || typeof source !== 'object') return source
  const layer = authorFillLayer(source, apiVersion, width, height)
  const key = authorLayerId(layer, index), draw = layer.draw, pose = layer.pose, effects = layer.effects
  const adjust = apiVersion >= CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION ? layer.adjust : undefined
  return {
    ...layer,
    ...(typeof effects === 'function' ? { effects: (time: number) => authorCall(fonts, `effects:${key}`, time, () => effects.call(layer, time)) } : {}),
    ...(typeof adjust === 'function' ? { adjust: (time: number) => authorCall(fonts, `adjust:${key}`, time, () => adjust.call(layer, time)) } : {}),
    ...(typeof draw === 'function' ? { draw: (ctx: OffscreenCanvasRenderingContext2D, time: number) => authorCall(fonts, `draw:${key}`, time, () => draw.call(layer, ctx, time)) } : {}),
    ...(typeof pose === 'function' ? { pose: (time: number) => authorCall(fonts, `pose:${key}`, time, () => pose.call(layer, time)) } : {}),
  }
}

function deterministicWebGL(webgl: AuthorWebGL, fonts?: TextFontAccess): AuthorWebGL {
  if (!webgl || typeof webgl !== 'object' || typeof webgl.draw !== 'function') return webgl
  const { draw, dispose } = webgl
  return {
    ...webgl,
    draw: (...args) => authorCall(fonts, 'webgl', args[0], () => draw.apply(webgl, args)),
    ...(typeof dispose === 'function' ? { dispose: () => authorAsync(fonts, 'dispose:webgl', 0, () => dispose.call(webgl)) } : {}),
  }
}

function deterministicWebGPU(webgpu: AuthorWebGPU, fonts?: TextFontAccess): AuthorWebGPU {
  if (!webgpu || typeof webgpu !== 'object' || typeof webgpu.draw !== 'function') return webgpu
  const { draw, dispose } = webgpu
  return {
    ...webgpu,
    draw: (...args) => authorAsync(fonts, 'webgpu', args[1], () => draw.apply(webgpu, args)),
    ...(typeof dispose === 'function' ? { dispose: () => authorAsync(fonts, 'dispose:webgpu', 0, () => dispose.call(webgpu)) } : {}),
  }
}

/** 作者模块的每个入口都经 runAuthorDeterministic 执行；layers() 返回的图层与 GPU 入口返回的绘制对象同样包装。 */
export function deterministicAuthorModule(effect: AuthorModule, apiVersion = CODE_AUTHOR_API_MIN_VERSION, fonts?: TextFontAccess): AuthorModule {
  const { draw, layers, createWebGL, createWebGPU, createThree, frameKey, dispose } = effect
  return {
    ...effect,
    ...(typeof createThree === 'function' ? { createThree: async (host: Parameters<typeof createThree>[0]) => {
      const scene = await authorCall(fonts, 'createThree', 0, () => createThree.call(effect, host))
      const update = scene.update
      return { ...scene, update: (...args: Parameters<typeof update>) => authorCall(fonts, 'three', args[2].time, () => update.apply(scene, args)),
        ...(scene.dispose ? { dispose: () => scene.dispose!() } : {}) }
    } } : {}),
    ...(typeof frameKey === 'function' ? { frameKey: (...args: Parameters<typeof frameKey>) => authorCall(fonts, 'frameKey', args[3].time, () => frameKey.apply(effect, args)) } : {}),
    ...(typeof draw === 'function' ? { draw: (...args: Parameters<typeof draw>) => authorCall(fonts, 'draw', args[1], () => draw.apply(effect, args)) } : {}),
    ...(typeof layers === 'function' ? { layers: (...args: Parameters<typeof layers>) => {
      const list = authorCall(fonts, 'layers', args[4]?.time, () => layers.apply(effect, args))
      return Array.isArray(list) ? list.map((layer, index) => deterministicLayer(layer, index, apiVersion, args[1], args[2], resolvedTextFontSession(fonts))) : list
    } } : {}),
    ...(typeof createWebGL === 'function' ? { createWebGL: (gl: WebGL2RenderingContext) => deterministicWebGL(authorCall(fonts, 'create', 0, () => createWebGL.call(effect, gl)), fonts) } : {}),
    ...(typeof createWebGPU === 'function' ? { createWebGPU: async (device: Parameters<typeof createWebGPU>[0]) => deterministicWebGPU(await authorAsync(fonts, 'create', 0, () => createWebGPU.call(effect, device)), fonts) } : {}),
    ...(typeof dispose === 'function' ? { dispose: () => authorAsync(fonts, 'dispose', 0, () => dispose.call(effect)) } : {}),
  }
}
