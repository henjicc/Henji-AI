import { describe, expect, it, vi } from 'vitest'
import { decodeSmartRegionLayout, type SmartRegionAnalysisKind } from '../../../../src/core/videoEdit/smartRegions'
import { runSmartRegionAnalysis, SmartRegionAnalysisError, type LocalModelRunner, type LocalTensorInput, type SmartRegionAnalysisDependencies } from './analysis'
import { float16Bits } from './fp16'
import { YUNET_INPUT_SIZE } from './analyzers/yunet'
import type { SmartRegionAnalysisJob } from './protocol'

function job(kind: SmartRegionAnalysisKind, overrides: Partial<SmartRegionAnalysisJob> = {}): SmartRegionAnalysisJob {
  return {
    id: 'job', kind, models: [{ name: 'yunet', path: '/m/yunet.onnx' }, { name: 'rvm', path: '/m/rvm.onnx' }, { name: 'selfie', path: '/m/selfie.onnx' }, { name: 'ppocr', path: '/m/ppocr.onnx' }],
    ffmpegPath: '/bin/ffmpeg', source: '/media/a.mp4', seekSeconds: 1, durationSeconds: 0.1, startUs: 1_000_000, endUs: 1_100_000, fps: 30,
    display: { width: 1920, height: 1080 }, outputPath: '/cache/out.tmp', providers: ['dml', 'cpu'], ...overrides,
  }
}

/** 一张人脸始终在画面中部的 YuNet 输出。 */
function faceOutputs(): Record<string, { data: Float32Array; dims: number[] }> {
  const outputs: Record<string, { data: Float32Array; dims: number[] }> = {}
  for (const stride of [8, 16, 32]) {
    const count = (YUNET_INPUT_SIZE / stride) ** 2
    outputs[`cls_${stride}`] = { data: new Float32Array(count), dims: [1, count, 1] }
    outputs[`obj_${stride}`] = { data: new Float32Array(count), dims: [1, count, 1] }
    outputs[`bbox_${stride}`] = { data: new Float32Array(count * 4), dims: [1, count, 4] }
  }
  const index = 10 * 40 + 20
  outputs.cls_16.data[index] = 0.95; outputs.obj_16.data[index] = 0.95
  outputs.bbox_16.data.set([0.5, 0.5, Math.log(4), Math.log(4)], index * 4)
  return outputs
}

function harness(kind: SmartRegionAnalysisKind, runners: Record<string, Partial<LocalModelRunner> & Pick<LocalModelRunner, 'run'>>, frameCount = 3) {
  const written: Uint8Array[] = []
  const requests: Array<{ width: number; height: number }> = []
  const controller = new AbortController()
  const progress = vi.fn()
  const deps: SmartRegionAnalysisDependencies = {
    openModel: async model => {
      const runner = runners[model.name]
      if (!runner) throw new Error(`no ${model.name}`)
      return { provider: 'dml', ...runner } as LocalModelRunner
    },
    async *frames(request) { requests.push(request); for (let index = 0; index < frameCount; index++) yield new Uint8Array(request.width * request.height * 3) },
    deflate: bytes => bytes,
    writeFile: async (_file, bytes) => { written.push(bytes) },
    progress, log: vi.fn(), signal: controller.signal, now: () => 0,
  }
  return { deps, written, requests, controller, progress, run: () => runSmartRegionAnalysis(job(kind), deps) }
}

describe('智能区域分析流程', () => {
  it('人脸：按 640 解码、逐帧检测并跟踪，结果文件含每帧框与摘要', async () => {
    const run = vi.fn(async () => faceOutputs())
    const test = harness('face', { yunet: { run } })
    const result = await test.run()
    expect(test.requests).toEqual([{ width: 640, height: 360 }])
    expect(run).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ model: 'yunet', provider: 'dml', frames: 3, summary: { value: 1, peak: 1 } })
    const { header } = decodeSmartRegionLayout(test.written[0])
    expect(header).toMatchObject({ kind: 'face', startUs: 1_000_000, endUs: 1_100_000, fps: 30, frameCount: 3, still: false, sourceWidth: 1920, sourceHeight: 1080 })
    expect(header.boxes!.map(frame => frame.length)).toEqual([1, 1, 1])
    expect(test.progress).toHaveBeenLastCalledWith(3, 3)
  })

  it('人物：RVM 时间递归状态逐帧接续，蒙版按帧写入文件尾部', async () => {
    const inputs: Array<Readonly<Record<string, LocalTensorInput>>> = []
    const outputs: Array<Record<string, { data: Uint16Array; dims: number[] }>> = []
    const run = vi.fn(async (feeds: Readonly<Record<string, LocalTensorInput>>) => {
      inputs.push(feeds)
      const state = (): { data: Uint16Array; dims: number[] } => ({ data: Uint16Array.of(outputs.length + 1), dims: [1, 16, 1, 1] })
      const result = { pha: { data: new Uint16Array(512 * 288).fill(float16Bits(1)), dims: [1, 1, 288, 512] }, r1o: state(), r2o: state(), r3o: state(), r4o: state() }
      outputs.push(result)
      return result
    })
    const test = harness('person', { rvm: { run } })
    const result = await test.run()
    expect(result.model).toBe('rvm')
    // 第一次是试跑；第一帧从零状态开始，之后每帧的输入状态就是上一帧的输出（同一个数组，不复制）。
    expect(run).toHaveBeenCalledTimes(4)
    expect([...(inputs[1].r1i.data as Uint16Array)]).toEqual([0])
    expect(inputs[2].r1i.data).toBe(outputs[1].r1o.data)
    expect(inputs[3].r4i.data).toBe(outputs[2].r4o.data)
    expect(inputs[2].r1i.dims).toEqual([1, 16, 1, 1])
    const layout = decodeSmartRegionLayout(test.written[0])
    expect(layout.header.matte).toEqual({ width: 512, height: 288 })
    expect(layout.frames).toHaveLength(3)
    expect(layout.header.summary.value).toBe(1)
  })

  it('人物：RVM 试跑失败时改用 Selfie（256 解码），并记日志', async () => {
    const test = harness('person', {
      rvm: { run: async () => { throw new Error('DML 不支持') } },
      selfie: { run: async () => ({ alphas: { data: new Float32Array(256 * 256).fill(0.5), dims: [1, 1, 256, 256] } }) },
    })
    const result = await test.run()
    expect(result.model).toBe('selfie')
    expect(test.requests).toEqual([{ width: 256, height: 256 }])
    expect(test.deps.log).toHaveBeenCalledWith('warn', expect.any(String), 'local_inference.person.fallback', expect.any(Object))
    expect(decodeSmartRegionLayout(test.written[0]).header.matte).toEqual({ width: 256, height: 144 })
  })

  it('文字：按 32 对齐的尺寸解码，概率图成框', async () => {
    const map = new Float32Array(736 * 416)
    for (let y = 300; y < 330; y++) for (let x = 200; x < 500; x++) map[y * 736 + x] = 0.95
    const test = harness('text', { ppocr: { run: async () => ({ out: { data: map, dims: [1, 1, 416, 736] } }) } })
    const result = await test.run()
    expect(test.requests).toEqual([{ width: 736, height: 416 }])
    expect(result.summary).toEqual({ value: 1, peak: 1 })
  })

  it('静态图片只取一帧；没有解码出画面或帧尺寸不符算解码失败；取消在下一帧前生效', async () => {
    const still = harness('face', { yunet: { run: async () => faceOutputs() } }, 5)
    const result = await runSmartRegionAnalysis(job('face', { durationSeconds: null, startUs: 0, endUs: 0, fps: 1 }), still.deps)
    expect(result.frames).toBe(1)
    expect(decodeSmartRegionLayout(still.written[0]).header.still).toBe(true)

    const empty = harness('face', { yunet: { run: async () => faceOutputs() } }, 0)
    await expect(empty.run()).rejects.toMatchObject({ code: 'decode' })

    const cancelled = harness('face', { yunet: { run: async () => { cancelled.controller.abort(); return faceOutputs() } } })
    await expect(cancelled.run()).rejects.toBeInstanceOf(SmartRegionAnalysisError)
    await expect(cancelled.run()).rejects.toMatchObject({ code: 'cancelled' })
    expect(cancelled.written).toHaveLength(0)
  })
})
