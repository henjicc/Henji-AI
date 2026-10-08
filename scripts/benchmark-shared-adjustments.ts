import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { init } from 'vgpu/node'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import type { GpuDevice, GpuTexture } from '../src/core/imageEdit/worker/webgpuRuntimeSupport'
import type { ImageEditorV3SourceTile } from '../src/platform/contracts/imageEditorV3'

process.stdout.write('[ie1-benchmark] loading shared runtime\n')
const { VideoEditBuiltinEffectsGpu } = await import('../src/features/videoEdit/engine/videoEditBuiltinEffectsGpu')
process.stdout.write('[ie1-benchmark] video runtime ready\n')
const { createImageEditDocumentV3, createImageEditRasterLayerV3, createImageEditAdjustmentLayerV3 } = await import('../src/core/imageEdit/v3/documentFactory')
process.stdout.write('[ie1-benchmark] document runtime ready\n')
const { compileImageEditorGpuRasterSceneV3 } = await import('../src/features/imageEdit/v3/gpu/imageEditorGpuRasterSceneCompilerV3')
process.stdout.write('[ie1-benchmark] scene runtime ready\n')
const { ImageEditorGpuRasterCompositorV3 } = await import('../src/features/imageEdit/v3/gpu/imageEditorGpuRasterCompositorV3')
process.stdout.write('[ie1-benchmark] compositor ready\n')
const { imageEditorGpuSceneTileKeyV3 } = await import('../src/features/imageEdit/v3/gpu/imageEditorGpuSceneProtocolV3')
const { ImageEditCommandBusV3 } = await import('../src/features/imageEdit/v3/application/imageEditCommandBus')
const { projectImageEditorPreviewDocumentV3 } = await import('../src/features/imageEdit/v3/execution/previewDocumentV3')
const { readVideoEditPreciseRow } = await import('../src/features/videoEdit/engine/videoEditGpuShaders')
const { parseCubeLut } = await import('../src/core/imaging/lut/cube')
const { LatestAdjustmentPreview } = await import('../src/core/imaging/adjustments/latestPreview')
process.stdout.write('[ie1-benchmark] runtime ready\n')
const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11) ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(baseline)) throw new Error('基线必须是完整 commit SHA')
const root = process.cwd()
const temporary = await fs.mkdtemp(path.join(root, '.tmp-ie1-baseline-'))
const size = process.argv.find(arg => arg.startsWith('--size='))?.slice(7) ?? '1920x1080'
if (!/^\d+x\d+$/.test(size)) throw new Error('尺寸使用 WIDTHxHEIGHT')
const [width, height] = size.split('x').map(Number)
if (!width || !height) throw new Error('尺寸必须为正整数')
const sourceRef = `sha256:${'a'.repeat(64)}` as const
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
async function time(render: (value: number) => Promise<void>): Promise<number[]> {
  await render(.1); await render(.2)
  const values: number[] = []
  for (let i = 0; i < 9; i++) { const start = performance.now(); await render(.3 + i / 20); values.push(performance.now() - start) }
  return values
}
process.stdout.write('[ie1-benchmark] initializing WebGPU\n')
const gpu = await init()
process.stdout.write('[ie1-benchmark] WebGPU ready\n')
try {
  const historical = ['videoEditBuiltinEffectsGpu', 'videoEditBuiltinEffectPasses', 'videoEditBuiltinEffectShaders', 'videoEditColorGradeShader']
  for (const file of historical) {
    let text = execFileSync('git', ['show', `${baseline}:src/features/videoEdit/engine/${file}.ts`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    text = text.replace(/from '\.\/([^']+)'/g, (match, dependency: string) => historical.includes(dependency) ? match : `from '@/features/videoEdit/engine/${dependency}'`)
    await fs.writeFile(path.join(temporary, `${file}.ts`), text)
  }
  const historicalModule = path.join(temporary, 'renderer.mjs')
  await build({ entryPoints: [path.join(temporary, 'videoEditBuiltinEffectsGpu.ts')], outfile: historicalModule, bundle: true, platform: 'node', format: 'esm', packages: 'external', alias: { '@': path.join(root, 'src') } })
  const { VideoEditBuiltinEffectsGpu: HistoricalRenderer } = await import(pathToFileURL(historicalModule).href) as { VideoEditBuiltinEffectsGpu: typeof VideoEditBuiltinEffectsGpu }
  const device = gpu.gpu
  const allocate = (w: number, h: number) => device.createTexture({ size: [w, h], format: 'rgba16float', usage: 1 | 2 | 4 | 16 })
  // Compare raw fp16 channels with the baseline, not only approximate CPU goldens.
  const regressionSource = allocate(64, 32), regressionBefore = allocate(64, 32), regressionAfter = allocate(64, 32)
  const halfValue = (value: number): number => { if (!value) return 0; const bits = new Uint32Array(new Float32Array([value]).buffer)[0]; return (((bits >>> 23) & 255) - 127 + 15) << 10 | (bits >>> 13) & 1023 }
  const pixels = new Uint16Array(64 * 32 * 4)
  for (let i = 0; i < 64 * 32; i++) {
    const alpha = i % 17 ? (i % 4 + 1) / 4 : 0
    pixels.set([((i % 64) / 63) * alpha, (Math.floor(i / 64) / 31) * alpha, ((i * 13 % 64) / 63) * alpha, alpha].map(halfValue), i * 4)
  }
  device.queue.writeTexture({ texture: regressionSource }, pixels, { bytesPerRow: 512, rowsPerImage: 32 }, [64, 32])
  const lut = parseCubeLut('LUT_3D_SIZE 2\n0 0 0\n.8 .1 0\n.1 .9 0\n.9 1 0\n0 0 1\n.8 .1 1\n.1 .9 1\n.9 1 1')
  const assets = [{ id: 'ie1-lut', name: 'fixture', path: 'C:/fixture.cube', contentIdentity: 'a'.repeat(64) }]
  const samples = [
    {}, { exposure: .8, temperature: 15, tint: -8, contrast: 12, highlights: -11, shadows: 22, whites: 6, blacks: -5, saturation: -20, vibrance: 10 },
    { faded_film: 17, sharpen: 30, creative_shadow_hue: 220, creative_shadow_strength: 12 },
    { curve_master_points: '[{"x":0,"y":0},{"x":35,"y":44},{"x":100,"y":100}]', curve_red_2: 63 },
    { curve_hue_sat_points: '[{"x":0,"y":50},{"x":35,"y":70},{"x":100,"y":50}]' },
    { shadow_hue: 30, shadow_strength: 25, midtone_luminance: 12, highlight_hue: 240, highlight_strength: 15 },
    { hsl_hue_start: 340, hsl_hue_end: 90, hsl_hue_feather: 15, hsl_blur: 20, hsl_denoise: 15, hsl_sharpen: 25, hsl_saturation: -20 },
    { vignette_amount: -40, vignette_midpoint: 30, vignette_roundness: 80, vignette_feather: 40 },
    { input_lut: 'ie1-lut', input_lut_strength: 65, look_lut: 'ie1-lut', look_lut_strength: 20 },
  ]
  const regressionRenderers = [HistoricalRenderer, VideoEditBuiltinEffectsGpu].map(Renderer => new Renderer(device as unknown as GpuDevice, device.createSampler({ minFilter: 'linear', magFilter: 'linear' }), { allocate: (w, h) => allocate(w, h) as unknown as GpuTexture, release: texture => texture.destroy() }, async () => lut))
  let mismatchedChannels = 0
  try {
    for (const params of samples) {
      for (let i = 0; i < 2; i++) await regressionRenderers[i].render({ id: 'color_grade', params }, { texture: regressionSource as unknown as GpuTexture, width: 64, height: 32, format: 'rgba16float' }, [regressionBefore, regressionAfter][i] as unknown as GpuTexture, 0, 1, assets)
      for (let row = 0; row < 32; row++) {
        const before = await readVideoEditPreciseRow(device, regressionBefore, 64, row), after = await readVideoEditPreciseRow(device, regressionAfter, 64, row)
        before.forEach((value, i) => { if (value !== after[i]) mismatchedChannels++ })
      }
    }
  } finally { regressionRenderers.forEach(renderer => renderer.dispose()); regressionSource.destroy(); regressionBefore.destroy(); regressionAfter.destroy() }
  if (mismatchedChannels) throw new Error(`剪辑共享调整像素回归失败：${mismatchedChannels} 个 fp16 通道不同`)
  const videoPixelRegression = { cases: samples.length, pixelsPerCase: 64 * 32, mismatchedChannels }
  const source = allocate(width, height), output = allocate(width, height)
  const half = new Uint16Array(width * height * 4)
  for (let i = 0; i < half.length; i += 4) half.set([0x3400, 0x3800, 0x3a00, 0x3c00], i)
  device.queue.writeTexture({ texture: source }, half, { bytesPerRow: width * 8, rowsPerImage: height }, [width, height])
  const video: Record<string, number> = {}
  for (const [label, Renderer] of [['before', HistoricalRenderer], ['after', VideoEditBuiltinEffectsGpu]] as const) {
    const renderer = new Renderer(device as unknown as GpuDevice, device.createSampler({ minFilter: 'linear', magFilter: 'linear' }), { allocate: (w, h) => allocate(w, h) as unknown as GpuTexture, release: texture => texture.destroy() })
    const timings = await time(async exposure => { await renderer.render({ id: 'color_grade', params: { exposure, temperature: 10 } }, { texture: source as unknown as GpuTexture, width, height, format: 'rgba16float' }, output as unknown as GpuTexture, 0); await device.queue.onSubmittedWorkDone() })
    video[label] = median(timings); renderer.dispose()
  }
  source.destroy(); output.destroy()
  const image: Record<string, number> = {}
  for (const kind of ['exposure', 'color_grade']) {
    const document = createImageEditDocumentV3({ width, height, documentId: `bench-${kind}` })
    document.layers = [createImageEditRasterLayerV3('source', '源', sourceRef), createImageEditAdjustmentLayerV3('grade', '调整', kind, kind === 'exposure' ? { stops: .1 } : { exposure: .1 })]
    const descriptors = [{ resourceRef: sourceRef, byteLength: width * height * 4, mediaType: 'image/png' }]
    const scene = () => { const compiled = compileImageEditorGpuRasterSceneV3(document, descriptors); if (!compiled.supported) throw new Error(compiled.reason); return compiled.scene }
    const compositor = new ImageEditorGpuRasterCompositorV3(gpu, { memoryBudgetBytes: 1024 ** 3 })
    compositor.syncScene(scene()); compositor.updateExportViewport({ stageWidth: width, stageHeight: height, viewportKey: 'ie1-bench', viewport: { documentX: 0, documentY: 0, width, height, zoom: 1, devicePixelRatio: 1 } })
    const uploaded = new Map<string, ReturnType<typeof compositor.uploadTile>>()
    for (const key of compositor.requiredResourceKeys()) {
      const w = Math.min(512, width - key.tileX * 512), h = Math.min(512, height - key.tileY * 512)
      const pixels = new Uint8Array(w * h * 4)
      for (let i = 0; i < pixels.length; i += 4) pixels.set([128, 96, 64, 255], i)
      const tile: ImageEditorV3SourceTile = { resourceRef: sourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY, halo: 0, width: w, height: h, channels: 4, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian', rowStride: w * 4, colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight', orientationApplied: true, originX: key.tileX * 512, originY: key.tileY * 512, pixels: pixels.buffer }
      uploaded.set(imageEditorGpuSceneTileKeyV3(key), compositor.uploadTile(key, tile))
    }
    const resolve = (key: Parameters<typeof compositor.uploadTile>[0]) => uploaded.get(imageEditorGpuSceneTileKeyV3(key)) ?? null
    const timings = await time(async exposure => { const layer = document.layers[1]; if (layer.type !== 'adjustment') throw new Error('缺少调整层'); layer.params = kind === 'exposure' ? { stops: exposure } : { exposure }; compositor.syncScene(scene()); await compositor.renderExportTarget(resolve); await device.queue.onSubmittedWorkDone() })
    image[kind] = median(timings)
    image[`${kind}_uploads`] = compositor.snapshotStats().uploadCount
    uploaded.forEach(texture => texture.destroy()); compositor.dispose()
  }
  const document = createImageEditDocumentV3({ width, height, documentId: 'preview-publish' })
  document.layers = [createImageEditAdjustmentLayerV3('grade', '调整', 'color_grade', {})]
  const bus = new ImageEditCommandBusV3(document); let publishes = 0
  const unsubscribe = bus.subscribe(() => { publishes++; compileImageEditorGpuRasterSceneV3(projectImageEditorPreviewDocumentV3(bus.getSnapshot()), []) })
  const publish = (exposure: number) => bus.setPreview({ id: 'bench-preview', kind: 'parameter', targetId: 'grade', baseRevision: 0, value: { exposure } })
  let scheduled: (() => void) | undefined
  const latest = new LatestAdjustmentPreview<number>(callback => { scheduled = callback; return 1 }, () => { scheduled = undefined }, publish)
  const main: Record<string, number> = {}
  for (const [label, update] of [['before', publish], ['after', (value: number) => latest.update(value)]] as const) {
    const timings: number[] = []; publishes = 0
    for (let trial = 0; trial < 9; trial++) { const start = performance.now(); for (let i = 0; i < 120; i++) update(i / 100); scheduled?.(); scheduled = undefined; timings.push(performance.now() - start) }
    main[label] = median(timings); main[`${label}_publishesPerBurst`] = publishes / 9
  }
  unsubscribe(); bus.dispose()
  await fs.writeFile(path.join(root, '.tmp-ie1-adjustment-baseline.json'), JSON.stringify({ baseline, width, height, metric: 'warm request-to-GPU-complete, no readback/presentation; main burst=120 inputs', videoPixelRegression, video, image, main }, null, 2))
} finally { gpu.dispose(); await fs.rm(temporary, { recursive: true, force: true }) }
process.exit(0)
