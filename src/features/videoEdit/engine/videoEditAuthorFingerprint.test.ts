import { expect, it, vi } from 'vitest'
import { authorFrameCodeIdentity, fingerprintAuthorFrame, fingerprintAuthorFrameKey } from './videoEditAuthorFingerprint'
import { deterministicAuthorModule } from './videoEditAuthorDeterminism'
import type { AuthorModule } from './videoEditAuthorModule'
import { videoEditRenderWindows } from '@/core/videoEdit/renderCache'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import * as builtinEffects from '@/core/videoEdit/builtinEffects'

const measure = { reset() {}, fillStyle: 'black', globalAlpha: 1, getImageData() {} } as unknown as OffscreenCanvasRenderingContext2D
const info = { time: 1, frameDuration: 1 / 60, clip: { time: 1, duration: 10 } }
const size = { width: 1920, height: 1080 }
const fingerprint = (effect: AuthorModule, time = 1, inputTime = 1) => fingerprintAuthorFrame(deterministicAuthorModule(effect), size, {}, { ...info, time },
  { screen: { width: 1920, height: 1080, identity: `media:revision-1:${inputTime}` } }, measure)
const scene = (position = 10, color = 'red', blur = 0): AuthorModule => ({ name: '测试', layers: (_p, _w, _h, assets) => [
  { id: 'window', bounds: [0, 0, 500, 400], pose: time => ({ x: time * position, opacity: .8, blur }), draw(ctx) { ctx.fillStyle = color; ctx.fillRect(0, 0, 500, 400); ctx.drawImage(assets.screen, 0, 0) } },
] })

it('位姿、绘制指令、虚化和输入取帧时间分别改变画面指纹，源码位置与重复执行不改变', () => {
  const base = fingerprint(scene())
  expect(base.digest).toBeTruthy()
  expect(fingerprint(scene())).toEqual(base)
  expect(fingerprint(scene(11))).not.toEqual(base)
  expect(fingerprint(scene(10, 'blue'))).not.toEqual(base)
  expect(fingerprint(scene(10, 'red', 2))).not.toEqual(base)
  expect(fingerprint(scene(), 1, 2)).not.toEqual(base)
  const annotated = scene(); const layers = annotated.layers!
  annotated.layers = (...args) => layers(...args).map(layer => ({ ...layer, name: '改名', sourceSpan: { file: 'main.ts', start: 0, end: 10, startLine: 99, startColumn: 1, endLine: 100, endColumn: 2 } }))
  expect(fingerprint(annotated)).toEqual(base)
  const placedSize = { ...size, frame: 300, sequenceTime: 5 }
  expect(fingerprintAuthorFrame(deterministicAuthorModule(scene()), placedSize, {}, info,
    { screen: { width: 1920, height: 1080, identity: 'media:revision-1:1' } }, measure)).toEqual(base)
})

it('快门边缘位姿也参与指纹，随机数与时钟使用正式确定性入口', () => {
  const effect = (changed: boolean): AuthorModule => ({ name: '快门', motionBlur: { shutter: 360, maxSamples: 16 }, layers: () => [{
    id: 'moving', bounds: [0, 0, 100, 100], pose: time => ({ x: time * 10000 + (changed && time < 1 ? 20 : 0) }),
    draw(ctx) { ctx.fillRect(Math.random() * 100, Date.now() / 1000, 20, 20) },
  }] })
  expect(fingerprint(effect(false))).toEqual(fingerprint(effect(false)))
  expect(fingerprint(effect(true))).not.toEqual(fingerprint(effect(false)))
})

it('原生 GPU、读像素、未知 API、可变对象与抛错均回退，不把失败当成空画面', () => {
  const cases: AuthorModule[] = [
    { name: 'GPU', createWebGPU: async () => ({ draw() {} }) },
    { name: 'read', draw: ctx => { ctx.getImageData(0, 0, 1, 1) } },
    { name: 'unknown', draw: ctx => { Reflect.get(ctx, 'unknownApi')() } },
    { name: 'mutable', draw: ctx => { ctx.drawImage({ width: 10, height: 10 } as CanvasImageSource, 0, 0) } },
    { name: 'failure', layers: () => { throw new Error('作者错误') } },
  ]
  for (const effect of cases) expect(fingerprint(effect)).toMatchObject({ fallback: expect.any(String) })
})

it('修改只在 2–3 秒出现的图层，升级片段版本后只有第一段窗口失效', () => {
  const document = createVideoEditTestDocument('局部图层')
  const sequence = document.sequences[0]
  sequence.frameRate = { numerator: 30, denominator: 1 }
  sequence.clips = [{ id: 'code', itemId: 'code', name: '图层', kind: 'code', track: 1, start: 0, duration: 450,
    sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '',
    code: { definitionId: 'definition', versionId: 'before', parameters: {} } }]
  const keys = (color: string, version: string) => {
    const effect = deterministicAuthorModule({ name: '局部', layers: (_p, _w, _h, _assets, info) => info.time >= 2 && info.time < 3
      ? [{ id: 'label', draw(ctx) { ctx.fillStyle = color; ctx.fillRect(0, 0, 100, 100) } }] : [] })
    const frames = new Map(Array.from({ length: 450 }, (_, frame) => [frame, fingerprintAuthorFrame(effect, size, {}, { ...info, time: frame / 30 }, {}, measure)]))
    sequence.clips[0].code!.versionId = version
    return videoEditRenderWindows(videoEditComposition(document, sequence.id), { fontRevision: 1, analysis: '', codeFingerprints: new Map([['code', { frames }]]) }).map(window => window.key)
  }
  const before = keys('red', 'before'), after = keys('blue', 'after')
  expect(after.map((key, index) => key === before[index])).toEqual([false, true, true])
})

it('声明键不求值素材/文字图层；每帧只调用一次并描述整个曝光，输入、参数与覆盖进入指纹，非法 JSON 回退', () => {
  const effect: AuthorModule = { name: '声明', motionBlur: { shutter: 360, maxSamples: 16 },
    layers: () => { throw new Error('不能读取素材或文字栅格') }, frameKey: (_p, _w, _h, info) => ({ x: info.time * 10000 }) }
  const times: number[] = [], frameKey = effect.frameKey!
  effect.frameKey = (...args) => { times.push(args[3].time); return frameKey(...args) }
  const key = (inputs = {}, params = {}, overrides = {}) => fingerprintAuthorFrameKey(effect, size, params, info, inputs, 'code', params, overrides)
  const base = key()
  expect(base.method).toBe('frameKey')
  expect(times).toEqual([info.time])
  effect.frameKey = (_p, _w, _h, info) => {
    expect(info.exposure).toEqual({ start: 1 - 1 / 120, end: 1 + 1 / 120, shutter: 360, phase: -180 })
    return { x: info.time * 10000 }
  }
  expect(key().digest).toBe(base.digest)
  expect(key({ image: { width: 100, height: 100, identity: 'media:1:time:2' } }).digest).not.toBe(base.digest)
  expect(key({}, { ink: 'blue' }).digest).not.toBe(base.digest)
  expect(key({}, {}, { layer: { hidden: true } }).digest).not.toBe(base.digest)
  effect.frameKey = (_p, _w, _h, info) => ({ x: info.time * 10000, edge: info.exposure!.start < 1 ? 'changed-edge' : null })
  expect(key().digest).not.toBe(base.digest)
  effect.frameKey = (_p, _w, _h, info) => ({ ...info })
  const ownInfo = key()
  expect(ownInfo.method).toBe('frameKey')
  expect(fingerprintAuthorFrameKey(effect, size, {}, { ...info, clip: { ...info.clip, duration: 11 } }, {}, 'code', {}, {}).digest).not.toBe(ownInfo.digest)
  const circular: { self?: unknown } = {}; circular.self = circular
  for (const invalid of [() => 1, { nested: () => 1 }, circular, NaN, Infinity, { n: NaN }, undefined, [undefined], Object.assign([1], { [Symbol()]: 2 }), Promise.resolve(1)]) {
    effect.frameKey = () => invalid
    expect(key()).toMatchObject({ fallback: expect.stringContaining('frame-key-error:') })
  }
})

it('没有 frameKey 时 dataFiles 不排除内容，入口、组件、库与 API 都参与代码身份', () => {
  const effect: AuthorModule = { name: '身份', dataFiles: ['data.ts'], draw() {} }
  const files = { entry: 'main.ts', files: { 'main.ts': 'paint', 'data.ts': 'data' } }
  const key = (input = files, pins = 'components:1') => authorFrameCodeIdentity(input, effect, pins)
  const before = key()
  expect(key({ ...files, files: { ...files.files, 'data.ts': 'changed' } })).not.toBe(before)
  effect.frameKey = () => null
  expect(key({ ...files, files: { ...files.files, 'data.ts': 'changed' } })).toBe(key())
  effect.dataFiles = ['main.ts', 'data.ts']
  expect(key({ ...files, files: { ...files.files, 'main.ts': 'changed drawing' } })).not.toBe(key())
  expect(key(files, 'components:2')).not.toBe(key())
  expect(authorFrameCodeIdentity({ ...files, apiVersion: 6, libraries: { three: '0.186.1' } }, effect, 'components:1')).not.toBe(key())
})

if (process.env.HENJI_FRAME_KEY_BENCHMARK === '1') it('2 万帧作者键计算基准（不含 IPC、编译及真实 GPU）', () => {
  for (const layers of [false, true]) {
    const effect = deterministicAuthorModule({ name: '帧清单', ...(layers ? { layers: () => [] } : { createWebGPU: async () => ({ draw() {} }) }),
      frameKey: (_p, width, height, info) => ({ camera: [Math.sin(info.time), width, height],
        windows: Array.from({ length: 4 }, (_, index) => ({ id: index, x: index * 100 + info.time, title: `窗口${index}`, visible: true })) }) })
    const started = performance.now()
    for (let frame = 0; frame < 20_000; frame++) {
      const value = fingerprintAuthorFrameKey(effect, size, {}, { ...info, time: frame / 30 }, {}, 'code', {}, undefined, true)
      if (!value.digest) throw new Error(value.fallback)
    }
    process.stdout.write(JSON.stringify({ frames: 20_000, layers, motionBlur: true, elapsedMs: performance.now() - started }) + '\n')
  }
}, 120_000)

// 显式规模基准只测作者执行、录制和散列；不把它当作真实窗口或 IPC 性能证据。
if (process.env.HENJI_FINGERPRINT_BENCHMARK === '1') it('2 万帧、三个贯穿片段的指纹计算基准', () => {
  const effect: AuthorModule = deterministicAuthorModule({ name: '台面窗口标注', layers: () => Array.from({ length: 8 }, (_, index) => ({
    id: `layer-${index}`, bounds: [0, 0, 1920, 1080] as [number, number, number, number], pose: time => ({ x: Math.sin(time + index) * 100, opacity: 1 }),
    draw(ctx) { ctx.fillStyle = 'white'; for (let item = 0; item < 20; item++) ctx.fillRect(item * 20, index * 30, 16, 24) },
  })) })
  const started = performance.now()
  for (let frame = 0; frame < 20_000; frame++) for (let clip = 0; clip < 3; clip++) {
    const result = fingerprintAuthorFrame(effect, size, {}, { ...info, time: frame / 30, clip: { time: frame / 30, duration: 20_000 / 30 } }, {}, measure)
    if (!result.digest) throw new Error(result.fallback)
  }
  process.stdout.write(JSON.stringify({ frames: 20_000, clips: 3, layersPerClip: 8, shapesPerLayer: 20, elapsedMs: performance.now() - started }) + '\n')
}, 120_000)

it('API 7 的 frameKey 与 recording 纳入实际效果，恒定 draw 键不能遮住动态参数；API 6 不求 layers', () => {
  let calls = 0
  const module = (strength?: number): AuthorModule => ({ name: '效果', frameKey: () => 'static', layers: () => { calls++; return [{ id: 'title', cacheKey: 'constant', effects: time => [{ id: 'glow', params: strength === undefined ? {} : { strength: strength + time } }], draw(ctx) { ctx.fillRect(0, 0, 10, 10) } }] } })
  const keyed = (effect: AuthorModule, version: number, time = 1) => fingerprintAuthorFrameKey(effect, size, {}, { ...info, time }, {}, 'code', {}, undefined, false, {}, version)
  const old = keyed(module(), 6); expect(old.digest).toBeTruthy(); expect(calls).toBe(0)
  expect(keyed(module(20), 6)).toEqual(old); expect(calls).toBe(0)
  const first = keyed(module(20), 7)
  expect(first.digest).toBeTruthy(); expect(calls).toBe(1)
  expect(keyed(module(20), 7)).toEqual(first)
  expect(keyed(module(20), 7, 2)).not.toEqual(first)
  const recorded = (strength: number) => fingerprintAuthorFrame(module(strength), size, {}, info, {}, measure, undefined, false, {}, 7)
  expect(recorded(20).digest).toBeTruthy()
  expect(recorded(21)).not.toEqual(recorded(20))
})

it.each([4, 5, 6])('API %s 的 recording 忽略 effects，指纹与没有该属性时相同', apiVersion => {
  const calls = vi.fn(() => { throw new Error('不应求值') })
  const fingerprint = (effects?: unknown) => fingerprintAuthorFrame({ name: '兼容', layers: () => [{ effects: effects as never, draw(ctx) { ctx.fillRect(0, 0, 10, 10) } }] }, size, {}, info, {}, measure, undefined, false, {}, apiVersion)
  const plain = fingerprint()
  expect(plain.digest).toBeTruthy()
  expect(fingerprint(calls)).toEqual(plain)
  expect(fingerprint(123)).toEqual(plain)
  expect(calls).not.toHaveBeenCalled()
})

it('声明键的图层可以捕获素材和读取尺寸，效果变化仍失效，不支持的素材读取保守回退', () => {
  const effect: AuthorModule = { name: '素材图层', frameKey: () => 'same', layers: (_p, _w, _h, assets) => {
    const image = assets.screen as ImageBitmap
    return [{ bounds: [0, 0, image.width, image.height], pose: () => ({ scale: image.width / 1920 }),
      effects: () => [{ id: 'glow', params: { strength: image.height / 100 } }], draw(ctx) { ctx.drawImage(image, 0, 0) } }]
  } }
  const key = (width = 1920, identity = 'media:1') => fingerprintAuthorFrameKey(effect, size, {}, info,
    { screen: { width, height: 1080, identity } }, 'code', {}, undefined, false, {}, 7)
  const base = key()
  expect(base.method).toBe('frameKey'); expect(base.digest).toBeTruthy()
  expect(key()).toEqual(base)
  expect(key(960)).not.toEqual(base)
  expect(key(1920, 'media:2')).not.toEqual(base)
  for (const read of [(image: CanvasImageSource) => Reflect.get(image, 'getContext'), (image: CanvasImageSource) => 'close' in image,
    (image: CanvasImageSource) => Object.keys(image), (image: CanvasImageSource) => Object.getOwnPropertyDescriptor(image, 'width')]) {
    effect.layers = (_p, _w, _h, assets) => { read(assets.screen); return [] }
    expect(key().fallback).toContain('asset-outside-recording')
  }
})

it('同 frameKey 和素材身份下，随时间变化的图层效果使指纹失效', () => {
  const effect: AuthorModule = { name: '动态效果', frameKey: () => 'same', layers: (_p, _w, _h, assets) => {
    const image = assets.screen
    return [{ effects: time => [{ id: 'glow', params: { strength: time * 10 } }], draw(ctx) { ctx.drawImage(image, 0, 0) } }]
  } }
  const fingerprint = (time: number) => fingerprintAuthorFrameKey(effect, size, {}, { ...info, time },
    { screen: { width: 1920, height: 1080, identity: 'same-media' } }, 'same-code', {}, undefined, false, {}, 7)
  const first = fingerprint(0)
  expect(first.digest).toBeTruthy()
  expect(fingerprint(0)).toEqual(first)
  expect(fingerprint(1).digest).toBeTruthy()
  expect(fingerprint(1).digest).not.toBe(first.digest)
})

it('未知解码尺寸不能用登记宽高求效果，单纯捕获素材仍可使用声明键', () => {
  const input = { width: 1920, height: 1080, identity: 'same-media', dimensionsKnown: false }
  const effect: AuthorModule = { name: '代理尺寸', frameKey: () => 'same', layers: (_p, _w, _h, assets) => {
    const image = assets.screen
    return [{ draw(ctx) { ctx.drawImage(image, 0, 0) } }]
  } }
  const fingerprint = () => fingerprintAuthorFrameKey(effect, size, {}, info, { screen: input }, 'code', {}, undefined, false, {}, 7)
  expect(fingerprint().digest).toBeTruthy()
  effect.layers = (_p, _w, _h, assets) => [{ effects: () => [{ id: 'glow', params: { strength: (assets.screen as ImageBitmap).width / 100 } }], draw() {} }]
  expect(fingerprint().fallback).toContain('decoded-asset-size-required')
  effect.layers = (_p, _w, _h, assets) => [{ draw(ctx) { ctx.drawImage(assets.screen, 0, 0) } }]
  expect(fingerprintAuthorFrame(effect, size, {}, info, { screen: input }, measure, undefined, false, {}, 7).fallback).toContain('decoded-asset-size-required')
})

it('调整层在录制与 frameKey 指纹里包括实际效果、opacity、clip 和颗粒帧种子，不受无效位姿影响', () => {
  const sample = (amount = 30, opacity = 1, clip = [0, 0, 100, 100] as [number, number, number, number], x = 0): AuthorModule => ({ name: '调整', frameKey: () => 'fixed', layers: () => [{ id: 'grade', clip, pose: () => ({ opacity, x }), adjust: () => [{ id: 'film_grain', params: { amount } }] }] })
  const digest = (module: AuthorModule, declared: boolean, time = 1) => declared
    ? fingerprintAuthorFrameKey(module, size, {}, { ...info, time }, {}, 'code', {}, undefined, false, {}, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION)
    : fingerprintAuthorFrame(module, size, {}, { ...info, time }, {}, measure, undefined, false, {}, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION)
  for (const declared of [true, false]) {
    const base = digest(sample(), declared)
    expect(base.digest).toBeTruthy()
    expect(digest(sample(30, 1, [0, 0, 100, 100], 500), declared)).toEqual(base)
    expect(digest(sample(31), declared)).not.toEqual(base)
    expect(digest(sample(30, .5), declared)).not.toEqual(base)
    expect(digest(sample(30, 1, [0, 0, 50, 50]), declared)).not.toEqual(base)
    expect(digest(sample(), declared, 2)).not.toEqual(base)
  }
})

it('按帧取种子由效果声明驱动，恒定 frameKey 不会冻结其他逐帧效果', () => {
  const requireEffect = builtinEffects.requireVideoEditBuiltinEffect
  const seeded = vi.spyOn(builtinEffects, 'requireVideoEditBuiltinEffect').mockImplementation(id => {
    const definition = requireEffect(id)
    return id === 'black_white' ? { ...definition, frameSeeded: true } : definition
  })
  const effect: AuthorModule = { name: '声明种子', frameKey: () => 'settled', layers: () => [{ id: 'grade', adjust: () => [{ id: 'black_white' }] }] }
  try {
    for (const declared of [true, false]) {
      const fingerprint = (time: number) => declared
        ? fingerprintAuthorFrameKey(effect, size, {}, { ...info, time }, {}, 'code', {}, undefined, false, {}, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION)
        : fingerprintAuthorFrame(effect, size, {}, { ...info, time }, {}, measure, undefined, false, {}, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION)
      expect(fingerprint(1).digest).toBeTruthy()
      expect(fingerprint(1)).not.toEqual(fingerprint(1 + info.frameDuration))
    }
  } finally { seeded.mockRestore() }
})

it.each([4, 7, 8])('API %s 不读取继承的 adjust，保留自定义字段的指纹语义', apiVersion => {
  const adjust = vi.fn(() => { throw new Error('旧接口不求 adjust') })
  const inherited = { get adjust(): never { return adjust() } }
  const module = (custom = false): AuthorModule => ({ name: '兼容', frameKey: () => 'settled', layers: () => {
    const layer = { id: 'base', draw(ctx: OffscreenCanvasRenderingContext2D) { ctx.fillRect(0, 0, 10, 10) } }
    return [custom ? Object.setPrototypeOf(layer, inherited) : layer]
  } })
  const recorded = (custom: boolean) => fingerprintAuthorFrame(module(custom), size, {}, info, {}, measure, undefined, false, {}, apiVersion)
  const keyed = (custom: boolean) => fingerprintAuthorFrameKey(module(custom), size, {}, info, {}, 'code', {}, undefined, false, {}, apiVersion)
  expect(recorded(false).digest).toBeTruthy()
  expect(recorded(true)).toEqual(recorded(false))
  expect(keyed(true)).toEqual(keyed(false))
  expect(adjust).not.toHaveBeenCalled()
  const data = module()
  const layer = data.layers!({}, size.width, size.height, {}, info)[0]
  Object.defineProperty(layer, 'adjust', { value: 1, enumerable: true, writable: true })
  data.layers = () => [layer]
  const first = fingerprintAuthorFrame(data, size, {}, info, {}, measure, undefined, false, {}, apiVersion)
  expect(first.digest).toBeTruthy()
  Reflect.set(layer, 'adjust', 2)
  expect(fingerprintAuthorFrame(data, size, {}, info, {}, measure, undefined, false, {}, apiVersion)).not.toEqual(first)
})
