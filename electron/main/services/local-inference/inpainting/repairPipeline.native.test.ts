import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { loadOnnxRuntime, LocalModelSessions } from '../onnxRuntime'
import { runImageInpaint } from './inpaint'
import { ContentAddressedResourceStore } from '../../image-editor-v3/resource-store'
import { encodeImageEditBrushTileV3 } from '../../image-editor-v3/brush-tile-codec'
import { decodeInterleavedRgbaSourceTileV3 } from '../../../../../src/core/imageEdit/v3/execution/sourceTileDecode'
import { copyImageEditRepairSourceV3, mergeImageEditRepairPatchV3, type ImageEditRepairBitmapV3 } from '../../../../../src/core/imageEdit/v3/repair'

const models = process.env.HENJI_INPAINT_MODELS, report = process.env.HENJI_REPAIR_REPORT
const W = 1920, H = 1080
const decode = (pixels: Uint8Array, width: number, height: number) => decodeInterleavedRgbaSourceTileV3({ width, height, rowStride: width * 4, bitDepth: 8, sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian', transferFunction: 'srgb', alphaMode: 'straight', pixels })

// 显式原生后端测量，不冒充 Electron 松手/IPC/呈现延迟。权重复用已下载模型，绝不下载。
describe.skipIf(!models || !report)('1080p 移除与指定来源原生补丁管线', () => {
  it('CPU/DML 真实推理、同源像素合并与正式瓦片编码落盘，输出对比与分段数字', async () => {
    await fs.mkdir(report!, { recursive: true })
    const source = await sharp('tests/fixtures/image-inpainting/brick-large-source.png').resize(W, H).ensureAlpha().raw().toBuffer()
    const mask = await sharp('tests/fixtures/image-inpainting/brick-large-mask.png').resize(W, H, { kernel: 'nearest' }).toColourspace('b-w').raw().toBuffer()
    let left = W, top = H, right = 0, bottom = 0
    for (let i = 0; i < mask.length; i++) if (mask[i]) { left = Math.min(left, i % W); right = Math.max(right, i % W + 1); top = Math.min(top, Math.floor(i / W)); bottom = Math.max(bottom, Math.floor(i / W) + 1) }
    const bounds = { x: Math.max(0, left - 64), y: Math.max(0, top - 64), width: Math.min(W, right + 64) - Math.max(0, left - 64), height: Math.min(H, bottom + 64) - Math.max(0, top - 64) }
    const scale = Math.max(1, bounds.width / 640, bounds.height / 640), pw = Math.ceil(bounds.width / scale), ph = Math.ceil(bounds.height / scale)
    const store = new ContentAddressedResourceStore(path.join(report!, 'resources'))
    const rows: Record<string, unknown>[] = []
    const panels: Buffer[] = [await sharp(source, { raw: { width: W, height: H, channels: 4 } }).extract({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }).resize(640, 360, { fit: 'fill' }).png().toBuffer()]
    let inputPaths = { image: '', mask: '' }
    for (const requested of ['cpu', 'dml'] as const) {
      const pool = new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
      try {
        for (let repeat = 0; repeat < 3; repeat++) {
          const started = performance.now()
          const bitmap: ImageEditRepairBitmapV3 = { region: { x: bounds.x, y: bounds.y, width: pw, height: ph }, sampleScale: scale, rgba: new Uint8Array(pw * ph * 4), mask: new Uint8Array(pw * ph) }
          for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) bitmap.mask[y * pw + x] = mask[Math.floor(bounds.y + y * scale) * W + Math.floor(bounds.x + x * scale)]
          const tiles = []
          for (let ty = Math.floor(bounds.y / 512); ty < Math.ceil((bounds.y + bounds.height) / 512); ty++) for (let tx = Math.floor(bounds.x / 512); tx < Math.ceil((bounds.x + bounds.width) / 512); tx++) {
            const region = { x: tx * 512, y: ty * 512, width: Math.min(512, W - tx * 512), height: Math.min(512, H - ty * 512) }
            const bytes = await sharp(source, { raw: { width: W, height: H, channels: 4 } }).extract({ left: region.x, top: region.y, width: region.width, height: region.height }).raw().toBuffer()
            const tile = decode(bytes, region.width, region.height); copyImageEditRepairSourceV3(tile, region, bitmap); tiles.push({ region, tile })
          }
          const image = await store.putBuffer(await sharp(bitmap.rgba, { raw: { width: pw, height: ph, channels: 4 } }).png().toBuffer(), { mediaType: 'image/png' })
          const selection = await store.putBuffer(await sharp(bitmap.mask, { raw: { width: pw, height: ph, channels: 1 } }).toColourspace('b-w').png().toBuffer(), { mediaType: 'image/png' })
          inputPaths = { image: store.getFilesystemPath(image.id), mask: store.getFilesystemPath(selection.id) }
          const preparedMs = performance.now() - started
          const outputPath = path.join(report!, `1080p-migan-${requested}.png`)
          const result = await runImageInpaint({ id: `repair-${requested}-${repeat}`, sourcePath: store.getFilesystemPath(image.id), maskPath: store.getFilesystemPath(selection.id), outputPath, roi: { left: 0, top: 0, width: pw, height: ph }, algorithm: 'migan', quality: 'fast', model: { name: 'migan', path: path.join(models!, '图片修补 MI-GAN', 'migan.onnx') }, providers: requested === 'dml' ? ['dml', 'cpu'] : ['cpu'] }, { signal: new AbortController().signal, progress: () => undefined, log: () => undefined, openModel: (model, providers, shape) => pool.open(model, providers, shape) })
          const patch = decode(await sharp(outputPath).raw().toBuffer(), pw, ph), mergeStart = performance.now()
          for (const { region, tile } of tiles) {
            const coverage = new Uint8Array(region.width * region.height)
            for (let y = 0; y < region.height; y++) coverage.set(mask.subarray((region.y + y) * W + region.x, (region.y + y) * W + region.x + region.width), y * region.width)
            const data = mergeImageEditRepairPatchV3(tile, region, patch, { region, rgba: new Uint8Array(0), mask: coverage }, { x: bounds.x, y: bounds.y, scale })
            for (let i = 0; i < coverage.length; i++) {
              if (data[i * 4 + 3] !== tile.data[i * 4 + 3]) throw new Error('alpha 被修改')
              if (!coverage[i]) for (let c = 0; c < 3; c++) if (data[i * 4 + c] !== tile.data[i * 4 + c]) throw new Error('非选区被修改')
            }
            await store.putBuffer(await encodeImageEditBrushTileV3({ ...tile, data }))
          }
          rows.push({ requested, actual: result.provider, repeat, preparedMs, kernelMs: result.durationMs, mergePersistMs: performance.now() - mergeStart, pipelineMs: performance.now() - started, proxy: [pw, ph], tiles: tiles.length })
          if (repeat === 2) panels.push(await sharp(outputPath).resize(640, 360, { fit: 'fill' }).png().toBuffer())
        }
      } finally { await pool.dispose() }
    }
    const samplePath = path.join(report!, 'sample.png'), sampleOutput = path.join(report!, 'sample-repair.png')
    await sharp('tests/fixtures/image-inpainting/brick-large-original.png').resize(pw, ph).ensureAlpha().png().toFile(samplePath)
    const nativeSample = await runImageInpaint({ id: 'sample-repair', sourcePath: inputPaths.image, maskPath: inputPaths.mask, samplePath, outputPath: sampleOutput, roi: { left: 0, top: 0, width: pw, height: ph }, algorithm: 'sample', quality: 'fast', providers: ['cpu'] }, { signal: new AbortController().signal, openModel: async () => { throw new Error('来源修补不得创建模型') }, progress: () => undefined, log: () => undefined })
    rows.push({ sourceRepairMs: nativeSample.durationMs })
    panels.push(await sharp(sampleOutput).resize(640, 360, { fit: 'fill' }).png().toBuffer())
    await fs.writeFile(path.join(report!, 'pipeline-metrics.json'), JSON.stringify({ frame: [W, H], bounds, excludes: ['Electron pointerup', 'IPC', 'selection raster worker scheduling', 'display presentation'], rows }, null, 2))
    await fs.copyFile(inputPaths.image, path.join(report!, 'prepared-source.png'))
    await fs.copyFile(inputPaths.mask, path.join(report!, 'prepared-mask.png'))
    await sharp({ create: { width: 640 * panels.length, height: 360, channels: 4, background: 'white' } }).composite(panels.map((input, i) => ({ input, left: i * 640, top: 0 }))).png().toFile(path.join(report!, 'comparison.png'))
    expect(rows.filter(row => row.requested)).toHaveLength(6)
  }, 180_000)
  it('精细档使用同一输入，输出额外目视参考，不重复 CPU/DML 性能基准', async () => {
    const metadata = await sharp(path.join(report!, 'prepared-source.png')).metadata(), width = metadata.width!, height = metadata.height!
    const pool = new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    try {
      const result = await runImageInpaint({ id: 'fine-reference', sourcePath: path.join(report!, 'prepared-source.png'), maskPath: path.join(report!, 'prepared-mask.png'), outputPath: path.join(report!, 'fine-lama.png'), roi: { left: 0, top: 0, width, height }, algorithm: 'lama', quality: 'fine', model: { name: 'lama', path: path.join(models!, '图片修补 LaMa', 'lama_fp32.onnx') }, providers: ['cpu'] }, { signal: new AbortController().signal, openModel: (model, providers, shape) => pool.open(model, providers, shape), progress: () => undefined, log: () => undefined })
      await fs.writeFile(path.join(report!, 'fine-metrics.json'), JSON.stringify(result, null, 2))
      const first = await sharp(path.join(report!, 'prepared-source.png')).resize(640, 360, { fit: 'fill' }).png().toBuffer()
      const fine = await sharp(result.outputPath).resize(640, 360, { fit: 'fill' }).png().toBuffer()
      await sharp({ create: { width: 1280, height: 360, channels: 4, background: 'white' } }).composite([{ input: first, left: 0, top: 0 }, { input: fine, left: 640, top: 0 }]).png().toFile(path.join(report!, 'comparison-fine.png'))
      expect(result.provider).toBe('cpu')
    } finally { await pool.dispose() }
  }, 60_000)
})
