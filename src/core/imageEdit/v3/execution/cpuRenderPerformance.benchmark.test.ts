import { afterAll, beforeAll, vi } from 'vitest'
import * as color from './tileColor'
import * as blend from './tileBlend'
import * as decode from './sourceTileDecode'
import * as kernels from './pixelKernels'
import * as affine from './affineTransform'
import * as output from '../../../../features/imageEdit/v3/export/outputTile'
// 复用唯一真实规模夹具，不复制保存实现；必须显式打开原基准开关。
import '../../../../tests/imageEditSavePerformance.benchmark.test'
import { buildCpuRegionTestWorkerV3, CpuRegionNodeTestWorkerV3 } from './cpuRegionWorker.testSupport'
import { ImageEditCpuRegionWorkerClientV3 } from './cpuRegionWorkerClient'

beforeAll(async () => {
  if (process.env.HENJI_IMAGE_CPU_WORKER_BENCH !== '1' || process.env.CI) return
  const source = await buildCpuRegionTestWorkerV3()
  vi.stubGlobal('Worker', class extends CpuRegionNodeTestWorkerV3 {
    constructor() { super(source) }
  })
})

const timings = new Map<string, { ms: number; calls: number }>()
function measured<T>(name: string, run: () => T): T {
  const start = performance.now()
  const done = () => {
    const total = timings.get(name) ?? { ms: 0, calls: 0 }
    total.ms += performance.now() - start
    total.calls += 1
    timings.set(name, total)
  }
  const result = run()
  if (result instanceof Promise) return result.finally(done) as T
  done()
  return result
}
if (process.env.HENJI_IMAGE_SAVE_BENCH === '1' && !process.env.CI) {
  const render = ImageEditCpuRegionWorkerClientV3.prototype.render
  vi.spyOn(ImageEditCpuRegionWorkerClientV3.prototype, 'render').mockImplementation(function (this: ImageEditCpuRegionWorkerClientV3, plan, region, context, result) {
    return render.call(this, plan, region, { ...context, onStage: (stage, ms) => {
      context.onStage?.(stage, ms)
      const total = timings.get(`worker.${stage}`) ?? { ms: 0, calls: 0 }
      total.ms += ms; total.calls++; timings.set(`worker.${stage}`, total)
    } }, result)
  })
  const decodeOriginal = decode.decodeInterleavedRgbaSourceTileV3
  vi.spyOn(decode, 'decodeInterleavedRgbaSourceTileV3').mockImplementation((...args) => measured('decode', () => decodeOriginal(...args)))
  const exposure = kernels.exposureCpuV3
  vi.spyOn(kernels, 'exposureCpuV3').mockImplementation((...args) => measured('exposure', () => exposure(...args)))
  const domain = color.convertFloat32TileColorDomainV3
  vi.spyOn(color, 'convertFloat32TileColorDomainV3').mockImplementation((...args) => measured('domain', () => domain(...args)))
  const opacity = blend.applyContentMaskAndOpacityV3
  vi.spyOn(blend, 'applyContentMaskAndOpacityV3').mockImplementation((...args) => measured('opacity', () => opacity(...args)))
  const composite = blend.compositePremultipliedTilesV3
  vi.spyOn(blend, 'compositePremultipliedTilesV3').mockImplementation((...args) => measured('composite', () => composite(...args)))
  const mix = blend.mixEffectLayerV3
  vi.spyOn(blend, 'mixEffectLayerV3').mockImplementation((...args) => measured('effect-mix', () => mix(...args)))
  const sample = affine.resampleImageEditRgbaAffineV3
  vi.spyOn(affine, 'resampleImageEditRgbaAffineV3').mockImplementation((...args) => measured('affine', () => sample(...args)))
  const project = output.projectImageEditorV3RenderedRegionToOutput
  vi.spyOn(output, 'projectImageEditorV3RenderedRegionToOutput').mockImplementation((...args) => measured('project', () => project(...args)))
  const encode = output.encodeImageEditorV3RenderedOutputTile
  vi.spyOn(output, 'encodeImageEditorV3RenderedOutputTile').mockImplementation((...args) => measured('encode', () => encode(...args)))
}
afterAll(() => {
  if (timings.size) process.stdout.write(`${JSON.stringify({ cpuStages: Object.fromEntries(timings) })}\n`)
  vi.unstubAllGlobals()
})
