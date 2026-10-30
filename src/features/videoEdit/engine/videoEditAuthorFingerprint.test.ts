import { expect, it } from 'vitest'
import { authorFrameCodeIdentity, fingerprintAuthorFrame, fingerprintAuthorFrameKey } from './videoEditAuthorFingerprint'
import { deterministicAuthorModule } from './videoEditAuthorDeterminism'
import type { AuthorModule } from './videoEditAuthorModule'
import { videoEditRenderWindows } from '@/core/videoEdit/renderCache'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'

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
