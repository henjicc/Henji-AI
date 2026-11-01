import { expect, it } from 'vitest'
import { init } from 'vgpu/node'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import { evaluateSpatialFrame } from '@/core/videoEdit/spatialEvaluation'
import { invertVideoEditTrackMatrix, videoEditTrackProject } from '@/core/videoEdit/tracking'
import { VideoEditSpatialGpu } from './videoEditSpatialComposite'
import { preparedSpatialBrand, type SpatialPictureLease, type SpatialTargetSpec } from './videoEditSpatialContracts'
import type { SpatialCodeSources, SpatialFrameRequest } from './videoEditSpatialContracts'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditCodePicture } from './videoEditCodePicture'
import { buildVideoEditCompositePlan } from '@/core/videoEdit/compositing'
import { planSpatialExposure } from './videoEditSpatialExposure'
import { renderVideoEditSpatialCompositeScene } from './videoEditCompositeScene'
import { planAuthorDefocus, planVideoEditBuiltinEffect } from './videoEditBuiltinEffectPasses'
import { videoEditHalfToFloat } from './videoEditGpuShaders'

it('真实 GPU 透视卡片保持 UV 插值与预乘覆盖率，提交后的借用独立于工作目标', async () => {
  const gpu = await init(), device = gpu.gpu, size = 128
  const allocated = new Set<unknown>()
  const host = new VideoEditSpatialGpu(device as unknown as GpuDevice, {
    allocate(spec, mipLevelCount, sampleCount) {
      const texture = device.createTexture({ size: [spec.width, spec.height], format: spec.format, usage: spec.usage, mipLevelCount, sampleCount })
      allocated.add(texture); return texture
    },
    release(texture) { expect(allocated.delete(texture)).toBe(true); texture.destroy() },
  })
  const source = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: 2 | 4 })
  const readback = device.createBuffer({ size: size * size * 4, usage: 1 | 8 })
  const spec: SpatialTargetSpec = { key: 'test', width: size, height: size, format: 'rgba8unorm', usage: 1 | 2 | 4 | 16 }
  let consumed: SpatialPictureLease | undefined, output: SpatialPictureLease | undefined
  try {
    const pixels = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels.set([x * 2, y * 2, 0, 255], (y * size + x) * 4)
    device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 4 }, [size, size])
    consumed = await host.consume({ texture: source, owner: 'code-sources', width: size, height: size, format: 'rgba8unorm', highPrecision: false, carriesLight: false, completion: Promise.resolve(), async release() {} }, spec)
    const document = createVideoEditDocument('透视'), sequence = createVideoEditSequence()
    sequence.clips = [{ id: 'card', itemId: 'text', kind: 'text', name: '卡片', track: 1, start: 0, duration: 40, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: .8, rotation: 0, opacity: 1, volume: 0, text: '', spatial: { enabled: true }, rotationY: 53 }]
    document.items = [{ id: 'text', kind: 'text', name: '卡片' }]; document.sequences = [sequence]
    const composition = videoEditComposition(document, sequence.id)
    const frame = evaluateSpatialFrame(composition, 10, { width: size, height: size, displayWidth: size, displayHeight: size }, 'final')
    const card = frame.cards[0], m = card.clipFromUv
    const inverse = invertVideoEditTrackMatrix([m[0], m[4], m[12], m[1], m[5], m[13], m[3], m[7], m[15]])
    const target = host.target(spec, true)
    try {
      const submitted = await host.draw(target, [{ itemId: 'card', sourceKey: 'card', clipId: 'card', kind: 'card', picture: consumed, geometry: card, opacity: 1, groupId: 'group', ordinal: 0, projection: 'material' }])
      await consumed.release(submitted.completion); consumed = undefined
      output = host.picture(target, false)
    } finally { await host.releaseTarget(target) }
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: output.texture as typeof source }, { buffer: readback, bytesPerRow: size * 4 }, [size, size])
    device.queue.submit([encoder.finish()]); await readback.mapAsync(1)
    const result = new Uint8Array(readback.getMappedRange())
    let count = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [u, v] = videoEditTrackProject(inverse, (x + .5) / size * 2 - 1, 1 - (y + .5) / size * 2)
      if (u < .08 || u > .92 || v < .08 || v > .92) continue
      const index = (y * size + x) * 4
      expect(result[index + 3]).toBe(255)
      expect(Math.abs(result[index] - (u * size - .5) * 2)).toBeLessThan(3)
      expect(Math.abs(result[index + 1] - (v * size - .5) * 2)).toBeLessThan(3)
      count++
    }
    expect(count).toBeGreaterThan(500)
    expect(result[3]).toBe(0)
    readback.unmap()
  } finally {
    await consumed?.release(Promise.resolve()); await output?.release(device.queue.onSubmittedWorkDone())
    await host.dispose(); source.destroy(); readback.destroy(); gpu.dispose()
  }
  expect(allocated.size).toBe(0)
}, 30_000)

it('真实镜头核在小 CoC 连接段连续，零半径不污染预乘透明边缘', async () => {
  const gpu = await init(), device = gpu.gpu, size = 64
  const allocations = new Set<unknown>()
  const host = new VideoEditSpatialGpu(device as unknown as GpuDevice, {
    allocate(spec, mipLevelCount, sampleCount) {
      const texture = device.createTexture({ size: [spec.width, spec.height], format: spec.format, usage: spec.usage, mipLevelCount, sampleCount })
      allocations.add(texture); return texture
    },
    release(texture) { allocations.delete(texture); texture.destroy() },
  })
  const source = device.createTexture({ size: [size, size], format: 'rgba16float', usage: 2 | 4 })
  const destination = device.createTexture({ size: [size, size], format: 'rgba16float', usage: 1 | 16 })
  const buffer = device.createBuffer({ size: size * size * 8, usage: 1 | 8 })
  try {
    const input = new Uint16Array(size * size * 4)
    for (let y = 10; y < 54; y++) for (let x = 10; x < 54; x++) input.set([0x3800, 0x3000, 0, 0x3800], (y * size + x) * 4)
    device.queue.writeTexture({ texture: source }, input, { bytesPerRow: size * 8 }, [size, size])
    const metrics: Array<{ radius: number; maxDifference: number; meanDifference: number }> = []
    for (const radius of [0, .124, .125, .126, .13, .2, .5]) {
      await host.encodeBuiltin(planAuthorDefocus(size, size, radius, true, false, { radiusY: radius, outputRadius: radius }), source, destination, 'rgba16float', [])
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer({ texture: destination }, { buffer, bytesPerRow: size * 8 }, [size, size])
      device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
      const actual = new Uint16Array(buffer.getMappedRange())
      let maximum = 0, total = 0
      for (let index = 0; index < input.length; index++) {
        const difference = Math.abs(videoEditHalfToFloat(actual[index]) - videoEditHalfToFloat(input[index]))
        maximum = Math.max(maximum, difference); total += difference
      }
      if (radius <= .125) expect(maximum).toBe(0)
      if (radius === .126) expect(maximum).toBeLessThan(1 / 1024)
      expect(Number.isFinite(total)).toBe(true)
      metrics.push({ radius, maxDifference: maximum, meanDifference: total / input.length })
      buffer.unmap()
    }
    expect(metrics.at(-1)!.maxDifference).toBeGreaterThan(0)
    if (process.env.HENJI_TEST_DIAGNOSTICS === '1') process.stdout.write(`spatial-coc-continuity ${JSON.stringify(metrics)}\n`)
  } finally { await host.dispose(); source.destroy(); destination.destroy(); buffer.destroy(); gpu.dispose() }
  expect(allocations.size).toBe(0)
}, 30_000)

it.each<Parameters<typeof planVideoEditBuiltinEffect>[0]>([
  { id: 'blur', params: { mode: 'uniform', amount: 40, repeat_edges: false } },
  { id: 'stroke', params: { width: 120, position: 'outside' } },
])('空间材料的 $id 效果保留中间格式且不丢失画面', async effect => {
  const gpu = await init(), device = gpu.gpu, size = 64
  const host = new VideoEditSpatialGpu(device as unknown as GpuDevice, {
    allocate(spec, mipLevelCount, sampleCount) {
      return device.createTexture({ size: [spec.width, spec.height], format: spec.format, usage: spec.usage, mipLevelCount, sampleCount })
    },
    release(texture) { texture.destroy() },
  })
  const source = device.createTexture({ size: [size, size], format: 'rgba16float', usage: 2 | 4 })
  const output = device.createTexture({ size: [size, size], format: 'rgba16float', usage: 1 | 16 })
  const buffer = device.createBuffer({ size: size * size * 8, usage: 1 | 8 })
  try {
    const pixels = new Uint16Array(size * size * 4)
    for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) pixels.set([0x3c00, 0, 0, 0x3c00], (y * size + x) * 4)
    device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 8 }, [size, size])
    const plan = planVideoEditBuiltinEffect(effect, { width: size, height: size, frame: 0, quality: 'final', referenceSize: { width: size, height: size } })
    device.pushErrorScope('validation')
    await host.encodeBuiltin(plan, source, output, 'rgba16float', [])
    expect(await device.popErrorScope()).toBeNull()
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: size * 8 }, [size, size])
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
    const result = new Uint16Array(buffer.getMappedRange()), center = (32 * size + 32) * 4
    expect(videoEditHalfToFloat(result[center])).toBeCloseTo(1, 3)
    expect(result[center]).toBe(result[center + 3])
    buffer.unmap()
  } finally { await host.dispose(); source.destroy(); output.destroy(); buffer.destroy(); gpu.dispose() }
}, 30_000)

it.each(['image', 'code'] as const)('真实合成树从 %s 的扩展参考平面生成材料面，透视后保留移入视口的内容', async kind => {
  const gpu = await init(), device = gpu.gpu, size = 128
  const shared = Object.assign(Object.create(VideoEditGpuCompositor.prototype) as VideoEditGpuCompositor, { device, ready: Promise.resolve(), canvasFormat: 'rgba8unorm' })
  const canvas = { width: size, height: size, getContext: () => ({ configure() {} }) } as unknown as OffscreenCanvas
  const compositor = new VideoEditGpuCompositor(canvas, shared)
  const source = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: 2 | 4 })
  const buffer = device.createBuffer({ size: size * size * 8, usage: 1 | 8 })
  let result: SpatialPictureLease | undefined
  try {
    const pixels = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels.set([255, 0, 0, 255], (y * size + x) * 4)
    device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 4 }, [size, size])
    const document = createVideoEditDocument('移入'), sequence = createVideoEditSequence()
    sequence.width = size; sequence.height = size; sequence.motionBlur = false
    sequence.clips = [{ id: 'card', itemId: 'image', kind: 'image', name: '卡片', track: 1, start: 0, duration: 40, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .7, y: 0, scale: .4, rotation: 0, opacity: .5, volume: 0, text: '', spatial: { enabled: true }, depth: -.9 }]
    document.media = [{ id: 'media', name: '画面', path: '/spatial-fixture.png', kind: 'image', width: size, height: size, durationSeconds: 0, hasAudio: false }]
    document.items = [{ id: 'image', kind: 'image', name: '画面', mediaId: 'media' }]; document.sequences = [sequence]
    const composition = videoEditComposition(document, sequence.id)
    const request: SpatialFrameRequest = { composition, sequenceFrame: 10, output: { width: size, height: size, displayWidth: size, displayHeight: size }, quality: 'final', sessionKind: 'observe', sources: [], requestId: 'real-card', signal: new AbortController().signal, assertCurrent() {} }
    const unexpected = (): never => { throw new Error('非代码卡片不应调用作者路径。') }
    const sources: SpatialCodeSources = { describeSpatialSources: unexpected,
      async prepareSpatialFrame() { return { [preparedSpatialBrand]: true } }, async inspectSpatialSceneSamples() { return [] },
      async renderSpatialSample(sample) {
        expect(sample.target.width).toBeGreaterThan(100)
        expect(sample.target.height).toBeGreaterThan(100)
        return { texture: source, width: size, height: size, format: 'rgba8unorm', owner: 'code-sources', highPrecision: false, carriesLight: false,
          completion: Promise.resolve(), async release(afterUse) { await afterUse } } as SpatialPictureLease
      }, generatorTargetCapacity: () => Infinity, async releaseSpatialFrame() {} }
    if (kind === 'code') request.sources = [{ clipId: 'card', kind: 'card', spaceDependency: true }]
    await compositor.prepare()
    const picture = new VideoEditCodePicture(source, size, size, device as unknown as GpuDevice)
    result = await renderVideoEditSpatialCompositeScene({ request, plan: planSpatialExposure(request), sources, drawn: composition, active: composition.clips,
      nodes: buildVideoEditCompositePlan(composition.clips), pictures: new Map([['card', picture]]), effects: new Map(), compositor })
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: result.texture as typeof source }, { buffer, bytesPerRow: size * 8 }, [size, size])
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
    const rgba = new Uint16Array(buffer.getMappedRange())
    let visible = 0
    for (let index = 0; index < rgba.length; index += 4) if (rgba[index + 3] !== 0) {
      visible++
      expect(rgba[index + 1]).toBe(0); expect(rgba[index + 2]).toBe(0)
      expect(rgba[index]).toBe(rgba[index + 3])
    }
    expect(visible).toBeGreaterThan(100)
    expect(rgba[(64 * size + 120) * 4 + 3]).toBe(0x3800)
    buffer.unmap()
  } finally {
    await result?.release(device.queue.onSubmittedWorkDone()); await compositor.dispose()
    source.destroy(); buffer.destroy(); gpu.dispose()
  }
}, 30_000)
