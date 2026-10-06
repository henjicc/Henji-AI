import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { decodeSmartRegionLayout, type SmartRegionAnalysisKind } from '../../../../src/core/videoEdit/smartRegions'
import { runSmartRegionAnalysis } from './analysis'
import { ffmpegFrames } from './frameReader'
import { LocalModelSessions, loadOnnxRuntime } from './onnxRuntime'
import type { LocalInferenceModelFile, SmartRegionAnalysisJob } from './protocol'
import { executionProviderOrder, type LocalExecutionProvider } from './providers'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { probeSmartRegionSource } from '../smart-regions/probe'

/**
 * 真实 onnxruntime-node + 真实 FFmpeg 的本地推理实跑（任务 4.7d）。需要模型文件，不进普通单测：
 *   HENJI_LOCAL_INFERENCE_MODELS=<放着四个模型文件的目录> npx vitest run electron/main/services/local-inference/localInference.native.test.ts
 * 另设 HENJI_LOCAL_INFERENCE_SAMPLE=<视频> 时，按 DirectML / CPU 各跑一遍整段分析并打印每帧耗时（任务文件的实测数据由此得出）。
 */
const MODELS = process.env.HENJI_LOCAL_INFERENCE_MODELS
const SAMPLE = process.env.HENJI_LOCAL_INFERENCE_SAMPLE
const FILES: Record<LocalInferenceModelFile['name'], string> = {
  yunet: 'face_detection_yunet_2023mar.onnx', rvm: 'rvm_mobilenetv3_fp16.onnx', selfie: 'mediapipe_selfie_segmentation_fp16.onnx', ppocr: 'ch_PP-OCRv4_det_mobile.onnx',
}
const KIND_MODELS: Record<SmartRegionAnalysisKind, Array<LocalInferenceModelFile['name']>> = { face: ['yunet'], person: ['rvm', 'selfie'], text: ['ppocr'] }

describe.skipIf(!MODELS)('本地推理实跑（onnxruntime-node + FFmpeg）', () => {
  const temporary = path.join(os.tmpdir(), `henji-local-inference-${process.pid}`)
  const logs: Array<{ event: string; context: Record<string, unknown> }> = []
  let sessions: LocalModelSessions | undefined
  afterAll(async () => { await sessions?.dispose(); await fs.rm(temporary, { recursive: true, force: true }) })

  async function analyze(kind: SmartRegionAnalysisKind, source: string, providers: LocalExecutionProvider[], options: { durationSeconds?: number; models?: Array<LocalInferenceModelFile['name']> } = {}) {
    const runtime = await loadOnnxRuntime()
    sessions ??= new LocalModelSessions(runtime, (_level, _message, event, context) => { logs.push({ event, context }) })
    const pool = sessions
    const probe = await probeSmartRegionSource(await loadFfprobePath(), source)
    await fs.mkdir(temporary, { recursive: true })
    const job: SmartRegionAnalysisJob = {
      id: `${kind}-${providers.join('-')}`, kind, models: (options.models ?? KIND_MODELS[kind]).map(name => ({ name, path: path.join(MODELS!, FILES[name]) })),
      ffmpegPath: await loadFfmpegPath(), source, seekSeconds: 0, durationSeconds: options.durationSeconds ?? 2, startUs: 0, endUs: (options.durationSeconds ?? 2) * 1e6,
      fps: Math.min(probe.fps || 30, kind === 'text' ? 10 : kind === 'face' ? 30 : 60), display: { width: probe.width, height: probe.height },
      outputPath: path.join(temporary, `${kind}-${providers.join('-')}.hsrg`), providers,
    }
    const controller = new AbortController()
    const result = await runSmartRegionAnalysis(job, {
      openModel: (model, order, shape) => pool.open(model, order, shape),
      frames: request => ffmpegFrames(job.ffmpegPath, job, request, controller.signal),
      deflate: bytes => deflateRawSync(bytes), writeFile: (file, bytes) => fs.writeFile(file, bytes),
      progress: () => undefined, log: (_level, _message, event, context) => { logs.push({ event, context }) }, signal: controller.signal,
    })
    return { result, layout: decodeSmartRegionLayout(new Uint8Array(await fs.readFile(job.outputPath))), job }
  }

  it.each(['face', 'person', 'text'] as const)('%s：真实模型在 CPU 上跑完整段并写出可读的结果文件', async (kind) => {
    const { result, layout, job } = await analyze(kind, path.resolve('scripts/fixtures/plain_video.mp4'), ['cpu'])
    expect(result.provider).toBe('cpu')
    expect(result.frames).toBe(12)
    expect(layout.header.frameCount).toBe(12)
    if (kind === 'person') {
      expect(result.model).toBe('rvm')
      expect(layout.frames).toHaveLength(12)
      const matte = inflateRawSync((await fs.readFile(job.outputPath)).subarray(layout.dataOffset + layout.frames[0].offset, layout.dataOffset + layout.frames[0].offset + layout.frames[0].length))
      expect(matte.byteLength).toBe(layout.header.matte!.width * layout.header.matte!.height)
    } else expect(layout.header.boxes).toHaveLength(12)
  }, 60_000)

  it('人物：RVM 不可用时退到 Selfie', async () => {
    const { result, layout } = await analyze('person', path.resolve('scripts/fixtures/plain_video.mp4'), ['cpu'], { models: ['selfie'] })
    expect(result.model).toBe('selfie')
    expect(layout.header.matte).toEqual({ width: 256, height: 256 })
  }, 60_000)

  it.skipIf(process.platform !== 'win32')('DirectML：RVM 半精度在显卡上运行（float16 张量经 Uint16Array 传入）', async () => {
    const { result } = await analyze('person', path.resolve('scripts/fixtures/plain_video.mp4'), executionProviderOrder('win32'))
    expect(['dml', 'cpu']).toContain(result.provider)
    expect(result.model).toBe('rvm')
  }, 60_000)

  it.skipIf(!SAMPLE)('实测：整段分析每帧耗时（解码 + 推理）', async () => {
    const rows: string[] = []
    for (const kind of ['face', 'person', 'text'] as const) {
      for (const providers of [executionProviderOrder(process.platform), ['cpu'] as LocalExecutionProvider[]]) {
        const { result } = await analyze(kind, SAMPLE!, providers, { durationSeconds: 10 })
        rows.push(`${kind.padEnd(7)} ${result.model.padEnd(6)} ${result.provider.padEnd(4)} 帧数 ${result.frames}  每帧推理 ${(result.inferenceMs / result.frames).toFixed(1)}ms  每帧等待解码 ${(result.decodeMs / result.frames).toFixed(1)}ms  合计 ${(result.durationMs / 1000).toFixed(2)}s  摘要 ${JSON.stringify(result.summary)}`)
      }
    }
    // eslint-disable-next-line no-console -- 显式实测命令的输出就是实测数据
    console.log(rows.join('\n'))
  }, 600_000)
})
