import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { LocalModelSessions, loadOnnxRuntime } from '../onnxRuntime'
import { runImageInpaint } from './inpaint'
import { imageEditRepairContextV3, analyzeImageEditRepairStructureV3, routeImageEditRepairQualityV3 } from '../../../../../src/core/imageEdit/v3/repairQuality'

const comparison = vi.hoisted(() => ({ radius: 3 }))
// 同一个生产内核，旧基线只关闭此次加入的孔洞外扩；不复制模型实现。
vi.mock('./networkMask', async original => {
  const actual = await original<typeof import('./networkMask')>()
  return { expandInpaintNetworkMask: (mask: Uint8Array, width: number, height: number) => actual.expandInpaintNetworkMask(mask, width, height, comparison.radius) }
})
const models = process.env.HENJI_INPAINT_MODELS, report = process.env.HENJI_IE5_QUALITY_REPORT
describe.skipIf(!models || !report)('固定砖墙真实原生画质对照', () => {
  it('前后两档、选区 MAE/PSNR、残红与边缘误差，验证非选区和 alpha 不变', async () => {
    await fs.mkdir(report!, { recursive: true })
    const width = 512, height = 512
    const source = await sharp('tests/fixtures/image-inpainting/brick-large-source.png').ensureAlpha().raw().toBuffer()
    const truth = await sharp('tests/fixtures/image-inpainting/brick-large-original.png').ensureAlpha().raw().toBuffer()
    const mask = await sharp('tests/fixtures/image-inpainting/brick-large-mask.png').toColourspace('b-w').raw().toBuffer()
    let left = width, top = height, right = 0, bottom = 0, count = 0
    for (let i = 0; i < mask.length; i++) if (mask[i]) { left = Math.min(left, i % width); right = Math.max(right, i % width + 1); top = Math.min(top, Math.floor(i / width)); bottom = Math.max(bottom, Math.floor(i / width) + 1); count++ }
    const roi = { left, top, width: right - left, height: bottom - top }
    const old = { x: Math.max(0, left - 64), y: Math.max(0, top - 64), width: Math.min(width, right + 64) - Math.max(0, left - 64), height: Math.min(height, bottom + 64) - Math.max(0, top - 64) }
    const current = imageEditRepairContextV3(roi, { width, height })
    const structure = analyzeImageEditRepairStructureV3({ region: { x: 0, y: 0, width, height }, rgba: new Uint8Array(source), mask: new Uint8Array(mask) })
    const rows: Record<string, unknown>[] = [], pool = new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    try {
      for (const version of ['before', 'after'] as const) for (const algorithm of ['migan', 'lama'] as const) {
        comparison.radius = version === 'before' ? 0 : 3
        const context = version === 'before' ? old : current, extract = { left: context.x, top: context.y, width: context.width, height: context.height }
        const sourcePath = path.join(report!, `${version}-source.png`), maskPath = path.join(report!, `${version}-mask.png`), outputPath = path.join(report!, `${version}-${algorithm}-crop.png`)
        await sharp(source, { raw: { width, height, channels: 4 } }).extract(extract).png().toFile(sourcePath)
        await sharp(mask, { raw: { width, height, channels: 1 } }).extract(extract).toColourspace('b-w').png().toFile(maskPath)
        const result = await runImageInpaint({ id: `${version}-${algorithm}`, sourcePath, maskPath, outputPath, roi: { left: 0, top: 0, width: context.width, height: context.height }, algorithm, quality: algorithm === 'migan' ? 'fast' : 'fine', model: { name: algorithm, path: path.join(models!, algorithm === 'migan' ? '图片修补 MI-GAN/migan.onnx' : '图片修补 LaMa/lama_fp32.onnx') }, providers: ['cpu'] }, { signal: new AbortController().signal, openModel: (file, providers, shape) => pool.open(file, providers, shape), log: () => undefined, progress: () => undefined })
        const patch = await sharp(outputPath).ensureAlpha().raw().toBuffer(), full = Buffer.from(source)
        for (let y = 0; y < context.height; y++) full.set(patch.subarray(y * context.width * 4, (y + 1) * context.width * 4), ((context.y + y) * width + context.x) * 4)
        let error = 0, squared = 0, red = 0, edgeError = 0, edgeCount = 0
        for (let i = 0; i < mask.length; i++) {
          expect(full[i * 4 + 3]).toBe(source[i * 4 + 3])
          if (!mask[i]) { for (let c = 0; c < 3; c++) if (full[i * 4 + c] !== source[i * 4 + c]) throw new Error('非选区被修改'); continue }
          const boundary = [i - 1, i + 1, i - width, i + width].some(j => j < 0 || j >= mask.length || !mask[j])
          for (let c = 0; c < 3; c++) { const d = Math.abs(full[i * 4 + c] - truth[i * 4 + c]); error += d; squared += d * d; if (boundary) { edgeError += d; edgeCount++ } }
          red += Math.max(0, full[i * 4] - truth[i * 4] - Math.max(0, full[i * 4 + 1] - truth[i * 4 + 1]))
        }
        rows.push({ version, algorithm, context, modelMaskRadius: comparison.radius, durationMs: result.durationMs, provider: result.provider, selectedMAE: error / (count * 3), selectedPSNR: 10 * Math.log10(255 * 255 / (squared / (count * 3))), boundaryMAE: edgeError / edgeCount, excessRed: red / count, outsideChanged: 0, alphaChanged: 0 })
        await sharp(full, { raw: { width, height, channels: 4 } }).png().toFile(path.join(report!, `${version}-${algorithm}.png`))
      }
    } finally { await pool.dispose() }
    await fs.writeFile(path.join(report!, 'quality-metrics.json'), JSON.stringify({ fixture: 'tests/fixtures/image-inpainting/brick-large-{source,mask,original}.png', frame: [width, height], selectedRatio: count / (width * height), structure, auto: routeImageEditRepairQualityV3('auto', roi, count / (width * height), structure), excludes: ['Electron/IPC/renderer scheduling', 'model download'], rows }, null, 2))
    expect(rows).toHaveLength(4)
  }, 180_000)
})
