import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { loadOnnxRuntime, LocalModelSessions } from '../onnxRuntime'
import { runImageInpaint } from './inpaint'
import type { ImageInpaintAlgorithm, ImageInpaintJob, ImageInpaintResult, InpaintRoi } from './protocol'
import { ImageInpaintService } from './service'

// 显式基准：HENJI_INPAINT_MODELS 指向现有“模型”目录，HENJI_INPAINT_REPORT 指向任务证据目录。
// 不启动 Electron 开发实例、不触碰 SQLite ABI；真实 ONNX/Sharp/OpenCV 在 Vitest forks 子进程中运行。
const models = process.env.HENJI_INPAINT_MODELS
const report = process.env.HENJI_INPAINT_REPORT
const fixtureRoot = path.resolve('tests/fixtures/image-inpainting')
interface Fixture { name: string; source: string; original: string; mask: string; roi: InpaintRoi }
interface Row {
  fixture: string; model: string; requested: string; actual: string; coldMs: number
  warm: ImageInpaintResult[]; rssBaselineMiB: number; rssPeakMiB: number
  gpuBaselineMiB: number | null; gpuDevicePeakMiB: number | null; maskedMae: number; unchangedPixels: boolean; alphaPreserved: boolean
}
const exec = promisify(execFile)
async function gpuMemory(): Promise<number | null> {
  try { const { stdout } = await exec('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true }); return Number(stdout.trim().split('\n')[0]) } catch { return null }
}

describe.skipIf(!models || !report)('本地修补模型固定夹具 CPU/DirectML 实测', () => {
  it('原生推理进行中取消：快速结束调用等待、保留 lease 到 run 完成并丢弃结果', async () => {
    await fs.mkdir(report!, { recursive: true })
    const pool = new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    const workerController = new AbortController(); const callerController = new AbortController()
    let notifyStarted!: () => void
    const started = new Promise<void>(resolve => { notifyStarted = resolve })
    let releases = 0; let publications = 0
    const temporary = path.join(report!, 'cancelled-temporary.png')
    const service = new ImageInpaintService({
      resources: {
        acquire: async ref => ({ path: path.join(fixtureRoot, ref.id === 'source' ? 'wall-scratch-source.png' : 'wall-scratch-mask.png'), release: async () => { releases++ } }),
        publishCopy: async () => { publications++; return { id: 'forbidden' } }, discard: async () => undefined,
      },
      inference: {
        inpaint: job => runImageInpaint(job, { signal: workerController.signal, progress: () => undefined, log: () => undefined,
          openModel: async (model, providers, shape) => {
            const runner = await pool.open(model, providers, shape)
            return { provider: runner.provider, run: feeds => { const pending = runner.run(feeds); notifyStarted(); return pending } }
          },
        }), cancel: () => workerController.abort(),
      },
      ensureModel: async () => path.join(models!, '图片修补 MI-GAN', 'migan.onnx'), providers: ['cpu'], log: () => undefined,
      temporaryPath: async () => temporary, removeTemporary: file => fs.rm(file, { force: true }),
    })
    try {
      const pending = service.run({ image: { id: 'source' }, mask: { id: 'mask' }, roi: { left: 0, top: 0, width: 512, height: 512 }, quality: 'fast' }, { signal: callerController.signal })
      await started
      const cancelStart = performance.now(); callerController.abort()
      await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
      const responseMs = performance.now() - cancelStart
      const retainedUntilRun = releases === 0
      await viWaitForIdle(service)
      const quiescenceMs = performance.now() - cancelStart
      expect(retainedUntilRun).toBe(true); expect(releases).toBe(2); expect(publications).toBe(0)
      await expect(fs.stat(temporary)).rejects.toThrow()
      await fs.writeFile(path.join(report!, 'cancellation.json'), JSON.stringify({ backend: 'cpu', responseMs, quiescenceMs, retainedUntilRun, releases, publications }, null, 2))
    } finally { service.dispose(); await pool.dispose() }
  }, 60_000)
  it('同输入、同融合：冷启动、热态分段延迟、内存与像素保护；导出可目视对比', async () => {
    await fs.mkdir(report!, { recursive: true })
    const fixtures = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'fixtures.json'), 'utf8')) as Fixture[]
    const rows: Row[] = []
    const fallbacks: Array<{ event: string; context: Record<string, unknown> }> = []
    const variants: Array<{ label: string; algorithm: ImageInpaintAlgorithm; modelPath?: string }> = [
      { label: 'migan', algorithm: 'migan', modelPath: path.join(models!, '图片修补 MI-GAN', 'migan.onnx') },
      { label: 'migan-pipeline', algorithm: 'migan', modelPath: path.join(models!, '图片修补 MI-GAN Pipeline', 'migan_pipeline_v2.onnx') },
      { label: 'lama', algorithm: 'lama', modelPath: path.join(models!, '图片修补 LaMa', 'lama_fp32.onnx') },
      { label: 'telea', algorithm: 'telea' }, { label: 'ns', algorithm: 'ns' },
    ]
    for (const variant of variants) for (const requested of variant.modelPath ? (process.platform === 'win32' ? ['cpu', 'dml'] : ['cpu']) : ['wasm']) {
      const pool = new LocalModelSessions(await loadOnnxRuntime(), (_level, _message, event, context) => { if (event.includes('fallback')) fallbacks.push({ event, context }) })
      const rssBaseline = process.memoryUsage().rss
      const gpuBaseline = await gpuMemory()
      let rssPeak = rssBaseline; let gpuPeak = gpuBaseline; let sampling = false
      const timer = setInterval(() => {
        rssPeak = Math.max(rssPeak, process.memoryUsage().rss)
        if (sampling) return
        sampling = true
        void gpuMemory().then(value => { if (value !== null) gpuPeak = Math.max(gpuPeak ?? value, value) }).finally(() => { sampling = false })
      }, 100)
      try {
        for (const fixture of fixtures) {
          const outputPath = path.join(report!, `${fixture.name}-${variant.label}-${requested}.png`)
          const job: ImageInpaintJob = { id: `${fixture.name}-${variant.label}-${requested}`, sourcePath: path.join(fixtureRoot, fixture.source), maskPath: path.join(fixtureRoot, fixture.mask),
            roi: fixture.roi, quality: variant.algorithm === 'lama' ? 'fine' : variant.modelPath ? 'fast' : 'blemish', algorithm: variant.algorithm,
            ...(variant.modelPath ? { model: { name: variant.algorithm as 'migan' | 'lama', path: variant.modelPath } } : {}),
            providers: requested === 'dml' ? ['dml', 'cpu'] : ['cpu'], outputPath }
          const run = (): Promise<ImageInpaintResult> => runImageInpaint(job, { signal: new AbortController().signal, openModel: (model, providers, shape) => pool.open(model, providers, shape), progress: () => undefined, log: () => undefined })
          const cold = await run(); const warm: ImageInpaintResult[] = []
          for (let repeat = 0; repeat < 3; repeat++) warm.push(await run())
          const [original, damaged, mask, output] = await Promise.all([
            sharp(path.join(fixtureRoot, fixture.original)).extract(fixture.roi).ensureAlpha().raw().toBuffer(),
            sharp(job.sourcePath).extract(fixture.roi).ensureAlpha().raw().toBuffer(),
            sharp(job.maskPath).extract(fixture.roi).toColourspace('b-w').raw().toBuffer(),
            sharp(outputPath).ensureAlpha().raw().toBuffer(),
          ])
          let difference = 0; let selected = 0; let unchanged = true; let alpha = true
          for (let i = 0; i < mask.length; i++) {
            alpha &&= output[i * 4 + 3] === original[i * 4 + 3]
            for (let c = 0; c < 3; c++) {
              if (mask[i]) { difference += Math.abs(output[i * 4 + c] - original[i * 4 + c]); selected++ }
              else unchanged &&= output[i * 4 + c] === damaged[i * 4 + c]
            }
          }
          expect(unchanged).toBe(true); expect(alpha).toBe(true)
          const row: Row = { fixture: fixture.name, model: variant.label, requested, actual: warm[2].provider,
            coldMs: cold.durationMs, warm, rssBaselineMiB: rssBaseline / 1024 ** 2, rssPeakMiB: Math.max(rssPeak, process.memoryUsage().rss) / 1024 ** 2,
            gpuBaselineMiB: gpuBaseline, gpuDevicePeakMiB: gpuPeak, maskedMae: difference / selected, unchangedPixels: unchanged, alphaPreserved: alpha }
          rows.push(row)
          await fs.writeFile(path.join(report!, 'metrics.json'), JSON.stringify({ machine: { cpu: os.cpus()[0].model, memoryGiB: os.totalmem() / 1024 ** 3, node: process.version, platform: process.platform }, rows, fallbacks }, null, 2))
        }
      } finally { clearInterval(timer); await pool.dispose() }
    }
    // 一张 CPU、一张 DML contact sheet；WASM 两列复用同一结果。结果 PNG 保留原 ROI 分辨率。
    for (const provider of process.platform === 'win32' ? ['cpu', 'dml'] : ['cpu']) {
      const tiles: Array<{ input: Buffer; left: number; top: number }> = []
      for (const [y, fixture] of fixtures.entries()) {
        const images = [path.join(fixtureRoot, fixture.original), path.join(fixtureRoot, fixture.source), ...variants.map(variant => path.join(report!, `${fixture.name}-${variant.label}-${variant.modelPath ? provider : 'wasm'}.png`))]
        for (const [x, file] of images.entries()) {
          const thumbnail = sharp(file)
          if (x < 2) thumbnail.extract(fixture.roi)
          tiles.push({ input: await thumbnail.resize(256, 256, { fit: 'contain', background: { r: 225, g: 225, b: 225, alpha: 1 } }).png().toBuffer(), left: x * 256, top: y * 280 + 24 })
          const label = `${fixture.name} / ${['original', 'masked', ...variants.map(v => v.label)][x]}`
          tiles.push({ input: Buffer.from(`<svg width="256" height="24"><text x="4" y="16" font-family="sans-serif" font-size="12" fill="black">${label}</text></svg>`), left: x * 256, top: y * 280 })
        }
      }
      await sharp({ create: { width: 256 * 7, height: fixtures.length * 280, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } } }).composite(tiles).png().toFile(path.join(report!, `comparison-${provider}.png`))
    }
  }, 900_000)
})

async function viWaitForIdle(service: ImageInpaintService): Promise<void> {
  const start = Date.now()
  while (service.hasActiveJobs()) {
    if (Date.now() - start > 30_000) throw new Error('原生推理取消后没有结束。')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
