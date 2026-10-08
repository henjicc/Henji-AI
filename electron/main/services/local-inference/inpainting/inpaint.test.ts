import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runImageInpaint, type ImageInpaintDependencies } from './inpaint'
import type { ImageInpaintJob } from './protocol'
import type { LocalTensorInput } from '../analysis'

describe('图片修补隔离内核', () => {
  let directory: string
  let job: ImageInpaintJob
  let original: Buffer
  let coverage: Buffer
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-inpaint-'))
    original = Buffer.from(Array.from({ length: 20 * 12 * 4 }, (_, i) => i % 4 === 3 ? 73 : i % 251))
    coverage = Buffer.alloc(20 * 12)
    coverage[5 * 20 + 8] = 255; coverage[5 * 20 + 9] = 128
    job = { id: 'test', sourcePath: path.join(directory, 'source.png'), maskPath: path.join(directory, 'mask.png'), outputPath: path.join(directory, 'patch.png'),
      roi: { left: 4, top: 3, width: 12, height: 6 }, algorithm: 'migan', quality: 'fast', model: { name: 'migan', path: 'verified' }, providers: ['cpu'] }
    await save()
  })
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })
  async function save(): Promise<void> {
    await sharp(original, { raw: { width: 20, height: 12, channels: 4 } }).png().toFile(job.sourcePath)
    await sharp(coverage, { raw: { width: 20, height: 12, channels: 1 } }).toColourspace('b-w').png().toFile(job.maskPath)
  }
  function deps(signal = new AbortController().signal): ImageInpaintDependencies {
    return { signal, log: vi.fn(), progress: vi.fn(), openModel: vi.fn(async () => ({ provider: 'cpu' as const, run: vi.fn(async () => ({ result: { dims: [1, 3, 512, 512], data: new Uint8Array(3 * 512 * 512).fill(200) } })) })) }
  }

  it('只融合 ROI 选区，保持 alpha、非选区 RGB 与源文件不变；MI-GAN mask 在内部翻转', async () => {
    const d = deps(); let feeds: Readonly<Record<string, LocalTensorInput>> = {}
    d.openModel = vi.fn(async () => ({ provider: 'cpu' as const, run: async (input: Readonly<Record<string, LocalTensorInput>>) => { feeds = input; return { result: { dims: [1, 3, 512, 512], data: new Uint8Array(3 * 512 * 512).fill(200) } } } }))
    const sourceBytes = await fs.readFile(job.sourcePath)
    const result = await runImageInpaint(job, d)
    const patch = await sharp(result.outputPath).raw().toBuffer()
    expect(patch.length).toBe(12 * 6 * 4)
    for (let y = 0; y < 6; y++) for (let x = 0; x < 12; x++) {
      const src = ((y + 3) * 20 + x + 4) * 4; const dst = (y * 12 + x) * 4
      expect(patch[dst + 3]).toBe(original[src + 3])
      for (let c = 0; c < 3; c++) expect(patch[dst + c]).toBe(Math.round(original[src + c] * (1 - coverage[src / 4] / 255) + 200 * coverage[src / 4] / 255))
    }
    expect(await fs.readFile(job.sourcePath)).toEqual(sourceBytes)
    expect(feeds.mask.type).toBe('uint8')
    expect(new Set(feeds.mask.data as Uint8Array)).toEqual(new Set([0, 255]))
    expect(feeds.image.dims).toEqual([1, 3, 512, 512])
    expect(d.progress).toHaveBeenLastCalledWith(4, 4)
  })

  it('LaMa 输入是 0..1、洞=1；输出 0..255，等比预处理保留非方形 ROI', async () => {
    job.algorithm = 'lama'; job.quality = 'fine'; job.model = { name: 'lama', path: 'verified' }
    const d = deps()
    d.openModel = async () => ({ provider: 'cpu', run: async feeds => {
      expect(feeds.image.type).toBe('float32')
      expect(Array.from(feeds.image.data as Float32Array).every(v => v >= 0 && v <= 1)).toBe(true)
      expect(new Set(feeds.mask.data as Float32Array)).toEqual(new Set([0, 1]))
      return { output: { dims: [1, 3, 512, 512], data: new Float32Array(3 * 512 * 512).fill(127) } }
    } })
    await runImageInpaint(job, d)
    const patch = await sharp(job.outputPath).raw().toBuffer()
    expect(patch[((5 - 3) * 12 + 8 - 4) * 4]).toBe(127)
  })

  it('取消原生 run 等待后拒绝迟到结果，不写补丁', async () => {
    const controller = new AbortController(); const d = deps(controller.signal)
    d.openModel = async () => ({ provider: 'cpu', run: async () => { controller.abort(); return { result: { dims: [1, 3, 512, 512], data: new Uint8Array(3 * 512 * 512) } } } })
    await expect(runImageInpaint(job, d)).rejects.toMatchObject({ code: 'cancelled' })
    await expect(fs.stat(job.outputPath)).rejects.toThrow()
  })

  it('空遮罩不下载/调用模型；越界、全选无上下文与错输出明确拒绝', async () => {
    coverage.fill(0); await save(); const d = deps()
    await runImageInpaint(job, d); expect(d.openModel).not.toHaveBeenCalled()
    job.roi.width = 30
    await expect(runImageInpaint(job, d)).rejects.toMatchObject({ code: 'decode' })
    job.roi.width = 12; coverage.fill(255); await save()
    await expect(runImageInpaint(job, d)).rejects.toMatchObject({ code: 'inference' })
    coverage.fill(0); coverage[5 * 20 + 8] = 255; await save()
    d.openModel = async () => ({ provider: 'cpu', run: async () => ({ result: { dims: [1, 3, 1, 1], data: new Uint8Array(3) } }) })
    await expect(runImageInpaint(job, d)).rejects.toMatchObject({ code: 'inference' })
  })

  it.each(['telea', 'ns'] as const)('真实 OpenCV %s 修补小瑕疵，不创建 ONNX 会话', async algorithm => {
    job.algorithm = algorithm; job.quality = 'blemish'; delete job.model
    const d = deps(); const result = await runImageInpaint(job, d)
    expect(result.provider).toBe('wasm'); expect(d.openModel).not.toHaveBeenCalled()
    expect((await sharp(job.outputPath).metadata()).width).toBe(12)
  })
  it('指定来源搬运真实纹理，保留非选区与 alpha；不调用模型，拒绝透明来源', async () => {
    job.algorithm = 'sample'; delete job.model
    job.samplePath = path.join(directory, 'sample.png')
    const sample = Buffer.alloc(12 * 6 * 4, 200)
    for (let i = 3; i < sample.length; i += 4) sample[i] = 255
    await sharp(sample, { raw: { width: 12, height: 6, channels: 4 } }).png().toFile(job.samplePath)
    const d = deps(); const result = await runImageInpaint(job, d)
    expect(result.provider).toBe('wasm'); expect(d.openModel).not.toHaveBeenCalled()
    const patch = await sharp(job.outputPath).raw().toBuffer()
    expect(patch[((5 - 3) * 12 + 8 - 4) * 4]).toBe(200)
    expect(patch[3]).toBe(73); expect(patch[0]).toBe(original[(3 * 20 + 4) * 4])
    sample.fill(0)
    await sharp(sample, { raw: { width: 12, height: 6, channels: 4 } }).png().toFile(job.samplePath)
    await expect(runImageInpaint(job, d)).rejects.toThrow('透明')
  })
})
