import {
  encodeSmartRegionSegment, smartRegionMaskSize, SMART_REGION_FORMAT_VERSION,
  type SmartRegionBox, type SmartRegionSegmentHeader,
} from '../../../../src/core/videoEdit/smartRegions'
import { decodeYunet, yunetInput, YUNET_INPUT_SIZE, type FaceDetection } from './analyzers/yunet'
import { trackFaces } from './analyzers/faceTracker'
import { matteCoverage, rvmInputSize, rvmMatte, rvmSourceTensor, RVM_DOWNSAMPLE_RATIO, selfieInput, selfieMatte, SELFIE_INPUT_SIZE } from './analyzers/matting'
import { ppocrInput, ppocrInputSize, stabilizeTextFrames, textBoxesFromMap } from './analyzers/textDetection'
import type { LocalInferenceFailureCode, LocalInferenceModelFile, LocalInferenceModelName, SmartRegionAnalysisJob, SmartRegionAnalysisResult } from './protocol'
import type { LocalExecutionProvider, LocalInferenceLog } from './providers'

/*
 * 一次智能区域分析（在本地推理后台进程里运行）：解码取帧（已按模型输入尺寸缩小）→ 推理 → 后处理 → 写结果文件。
 * 推理会话、解码、压缩、写文件都由调用方注入，单测可以用替身跑完整流程。
 */

export interface LocalTensorInput { type: 'float32' | 'float16' | 'int64' | 'uint8'; data: Float32Array | Uint16Array | BigInt64Array | Uint8Array; dims: readonly number[] }
export interface LocalTensorOutput { data: unknown; dims: readonly number[] }
export interface LocalModelRunner {
  readonly provider: LocalExecutionProvider
  run(feeds: Readonly<Record<string, LocalTensorInput>>): Promise<Record<string, LocalTensorOutput>>
}

export interface FrameRequest { width: number; height: number }

export interface SmartRegionAnalysisDependencies {
  /** 打开（或复用）模型会话；`shape` 是固定的输入尺寸，DirectML 按固定尺寸编译最快。运行失败的回退由会话自己负责。 */
  openModel(model: LocalInferenceModelFile, providers: readonly LocalExecutionProvider[], shape: string): Promise<LocalModelRunner>
  /** 按尺寸解码出 RGB24 帧（拉伸到给定宽高）。 */
  frames(request: FrameRequest): AsyncIterable<Uint8Array>
  deflate(bytes: Uint8Array): Uint8Array
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  progress(done: number, total: number): void
  log: LocalInferenceLog
  signal: AbortSignal
  now?: () => number
}

export class SmartRegionAnalysisError extends Error {
  constructor(readonly code: LocalInferenceFailureCode, message: string, options?: { cause?: unknown }) { super(message, options); this.name = 'SmartRegionAnalysisError' }
}

function floatOutput(outputs: Record<string, LocalTensorOutput>, name?: string): Float32Array {
  const value = name ? outputs[name] : Object.values(outputs)[0]
  if (!value || !(value.data instanceof Float32Array)) throw new SmartRegionAnalysisError('inference', `模型输出${name ? ` ${name} ` : ''}不是单精度张量。`)
  return value.data
}
function halfOutput(outputs: Record<string, LocalTensorOutput>, name: string): Uint16Array {
  const value = outputs[name]
  if (!value || !(value.data instanceof Uint16Array)) throw new SmartRegionAnalysisError('inference', `模型输出 ${name} 不是半精度张量。`)
  return value.data
}

function expectedFrames(job: SmartRegionAnalysisJob): number {
  return job.durationSeconds === null ? 1 : Math.max(1, Math.ceil(job.durationSeconds * job.fps - 1e-6))
}

/** 人脸检测的解码尺寸：按比例让长边恰好 640（小画面放大，提高小脸检出），放进 640×640 的左上角。 */
export function faceFrameSize(display: { width: number; height: number }): FrameRequest {
  const scale = YUNET_INPUT_SIZE / Math.max(1, display.width, display.height)
  return { width: Math.max(1, Math.min(YUNET_INPUT_SIZE, Math.round(display.width * scale))), height: Math.max(1, Math.min(YUNET_INPUT_SIZE, Math.round(display.height * scale))) }
}

interface Accumulated { model: LocalInferenceModelName; provider: LocalExecutionProvider; header: Partial<SmartRegionSegmentHeader>; frames: Uint8Array[] }

export async function runSmartRegionAnalysis(job: SmartRegionAnalysisJob, deps: SmartRegionAnalysisDependencies): Promise<SmartRegionAnalysisResult> {
  const now = deps.now ?? (() => performance.now())
  const started = now()
  const total = expectedFrames(job)
  let decodeMs = 0; let inferenceMs = 0; let done = 0
  const throwIfCancelled = (): void => { if (deps.signal.aborted) throw new SmartRegionAnalysisError('cancelled', '分析已取消。') }
  /** 逐帧驱动：记录等待解码与处理各自的耗时，按帧汇报进度。 */
  const each = async (request: FrameRequest, handle: (rgb: Uint8Array) => Promise<void>): Promise<void> => {
    const iterator = deps.frames(request)[Symbol.asyncIterator]()
    try {
      for (;;) {
        throwIfCancelled()
        const waited = now()
        const next = await iterator.next()
        decodeMs += now() - waited
        if (next.done) break
        if (next.value.byteLength !== request.width * request.height * 3) throw new SmartRegionAnalysisError('decode', '解码帧大小与请求不符。')
        const working = now()
        await handle(next.value)
        inferenceMs += now() - working
        done++
        deps.progress(Math.min(done, total), total)
        if (job.durationSeconds === null) break
      }
    } finally { await iterator.return?.() }
    throwIfCancelled()
    if (!done) throw new SmartRegionAnalysisError('decode', '素材没有解码出画面。')
  }
  const modelOf = (name: LocalInferenceModelName): LocalInferenceModelFile => {
    const model = job.models.find(entry => entry.name === name)
    if (!model) throw new SmartRegionAnalysisError('inference', `缺少模型 ${name}。`)
    return model
  }

  let accumulated: Accumulated
  if (job.kind === 'face') {
    const size = faceFrameSize(job.display)
    const runner = await deps.openModel(modelOf('yunet'), job.providers, `${YUNET_INPUT_SIZE}x${YUNET_INPUT_SIZE}`)
    const input = new Float32Array(3 * YUNET_INPUT_SIZE * YUNET_INPUT_SIZE)
    const detections: FaceDetection[][] = []
    await each(size, async (rgb) => {
      const outputs = await runner.run({ input: { type: 'float32', data: yunetInput(rgb, size.width, size.height, input), dims: [1, 3, YUNET_INPUT_SIZE, YUNET_INPUT_SIZE] } })
      const decoded: Record<string, Float32Array> = {}
      for (const name of Object.keys(outputs)) decoded[name] = floatOutput(outputs, name)
      detections.push(decodeYunet(decoded, size.width, size.height))
    })
    const boxes = trackFaces(detections, { fps: job.fps })
    const tracks = new Set(boxes.flatMap(frame => frame.map(box => box[5])))
    accumulated = { model: 'yunet', provider: runner.provider, frames: [], header: { boxes, summary: { value: tracks.size, peak: Math.max(0, ...boxes.map(frame => frame.length)) } } }
  } else if (job.kind === 'text') {
    const size = ppocrInputSize(job.display.width, job.display.height)
    const runner = await deps.openModel(modelOf('ppocr'), job.providers, `${size.width}x${size.height}`)
    const input = new Float32Array(3 * size.width * size.height)
    const frames: SmartRegionBox[][] = []
    await each(size, async (rgb) => {
      const outputs = await runner.run({ x: { type: 'float32', data: ppocrInput(rgb, size.width, size.height, input), dims: [1, 3, size.height, size.width] } })
      frames.push(textBoxesFromMap(floatOutput(outputs), size.width, size.height))
    })
    const boxes = stabilizeTextFrames(frames)
    accumulated = { model: 'ppocr', provider: runner.provider, frames: [], header: { boxes, summary: { value: boxes.filter(frame => frame.length).length / boxes.length, peak: Math.max(0, ...boxes.map(frame => frame.length)) } } }
  } else {
    accumulated = await analyzePerson(job, deps, each, modelOf)
  }

  const header: SmartRegionSegmentHeader = {
    version: SMART_REGION_FORMAT_VERSION, kind: job.kind, model: accumulated.model, startUs: job.startUs, endUs: job.endUs, fps: job.fps,
    frameCount: done, still: job.durationSeconds === null, sourceWidth: job.display.width, sourceHeight: job.display.height,
    summary: { value: 0, peak: 0 }, ...accumulated.header,
  }
  throwIfCancelled()
  try { await deps.writeFile(job.outputPath, encodeSmartRegionSegment(header, accumulated.frames)) }
  catch (error) { throw new SmartRegionAnalysisError('output', '分析结果写入缓存失败。', { cause: error }) }
  return { model: accumulated.model, provider: accumulated.provider, frames: done, summary: header.summary, decodeMs: Math.round(decodeMs), inferenceMs: Math.round(inferenceMs), durationMs: Math.round(now() - started) }
}

/** 人物：先用 RVM（试跑一帧确认能用），不行再用 Selfie。 */
async function analyzePerson(
  job: SmartRegionAnalysisJob, deps: SmartRegionAnalysisDependencies,
  each: (request: FrameRequest, handle: (rgb: Uint8Array) => Promise<void>) => Promise<void>,
  modelOf: (name: LocalInferenceModelName) => LocalInferenceModelFile,
): Promise<Accumulated> {
  const frames: Uint8Array[] = []
  let coverage = 0
  const rvm = job.models.find(model => model.name === 'rvm')
  if (rvm) {
    const size = rvmInputSize(job.display.width, job.display.height)
    const zero = (): LocalTensorInput => ({ type: 'float16', data: new Uint16Array(1), dims: [1, 1, 1, 1] })
    const ratio: LocalTensorInput = { type: 'float32', data: Float32Array.of(RVM_DOWNSAMPLE_RATIO), dims: [1] }
    let runner: LocalModelRunner | undefined
    try {
      runner = await deps.openModel(rvm, job.providers, `${size.width}x${size.height}`)
      await runner.run({ src: { type: 'float16', data: new Uint16Array(3 * size.width * size.height), dims: [1, 3, size.height, size.width] }, r1i: zero(), r2i: zero(), r3i: zero(), r4i: zero(), downsample_ratio: ratio })
    } catch (error) {
      if (error instanceof SmartRegionAnalysisError && error.code === 'cancelled') throw error
      deps.log('warn', '人物抠像 RVM 不可用，改用快速人像分割', 'local_inference.person.fallback', { reason: error instanceof Error ? error.message.slice(0, 300) : String(error) })
      runner = undefined
    }
    if (runner) {
      const active = runner
      const source = new Uint16Array(3 * size.width * size.height)
      let state: Record<'r1i' | 'r2i' | 'r3i' | 'r4i', LocalTensorInput> = { r1i: zero(), r2i: zero(), r3i: zero(), r4i: zero() }
      await each(size, async (rgb) => {
        const outputs = await active.run({ src: { type: 'float16', data: rvmSourceTensor(rgb, size.width, size.height, source), dims: [1, 3, size.height, size.width] }, ...state, downsample_ratio: ratio })
        const matte = rvmMatte(halfOutput(outputs, 'pha'))
        coverage += matteCoverage(matte)
        frames.push(deps.deflate(matte))
        // 时间递归状态：本帧输出接到下一帧输入（张量留在本进程，不复制）。
        const carry = (name: string): LocalTensorInput => ({ type: 'float16', data: halfOutput(outputs, name), dims: outputs[name].dims })
        state = { r1i: carry('r1o'), r2i: carry('r2o'), r3i: carry('r3o'), r4i: carry('r4o') }
      })
      return { model: 'rvm', provider: active.provider, frames, header: { matte: size, summary: { value: Math.round(coverage / frames.length * 1000) / 1000, peak: 0 } } }
    }
  }
  const selfie = modelOf('selfie')
  const runner = await deps.openModel(selfie, job.providers, `${SELFIE_INPUT_SIZE}x${SELFIE_INPUT_SIZE}`)
  const matteSize = smartRegionMaskSize(job.display.width, job.display.height, SELFIE_INPUT_SIZE)
  const input = new Float32Array(3 * SELFIE_INPUT_SIZE * SELFIE_INPUT_SIZE)
  await each({ width: SELFIE_INPUT_SIZE, height: SELFIE_INPUT_SIZE }, async (rgb) => {
    const outputs = await runner.run({ pixel_values: { type: 'float32', data: selfieInput(rgb, input), dims: [1, 3, SELFIE_INPUT_SIZE, SELFIE_INPUT_SIZE] } })
    const matte = selfieMatte(floatOutput(outputs, 'alphas'), matteSize.width, matteSize.height)
    coverage += matteCoverage(matte)
    frames.push(deps.deflate(matte))
  })
  return { model: 'selfie', provider: runner.provider, frames, header: { matte: matteSize, summary: { value: Math.round(coverage / frames.length * 1000) / 1000, peak: 0 } } }
}
