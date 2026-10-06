import {
  createVideoEditTrackHeader, decodeVideoEditTrackRecord, dequantizeVideoEditTrackLogits, encodeVideoEditTrackRecord, quantizeVideoEditTrackLogits,
  videoEditTrackLogitBox, VIDEO_EDIT_TRACK_LOGIT_SCALE, VIDEO_EDIT_TRACK_LOGIT_SIZE, type VideoEditTrackBox, type VideoEditTrackHeader,
} from '../../../../../src/core/videoEdit/tracking'
import { decodeSmartRegionLayout, encodeSmartRegionSegment } from '../../../../../src/core/videoEdit/smartRegions'
import type { LocalModelRunner } from '../analysis'
import type { LocalInferenceModelFile, LocalInferenceModelName } from '../protocol'
import type { LocalExecutionProvider, LocalInferenceLog } from '../providers'
import { EfficientTamSession, etamPromptFromNormalized, etamMemoryPlan, ETAM_CANDIDATES_OUTPUT, ETAM_IMAGE_SIZE, type EtamFeatures, type EtamFrameResult } from './efficientTam'
import { VitTracker, type VitFrame, type VitRect } from './vitTrack'
import type { TrackingCandidatesJob, TrackingCandidatesResult, TrackingJob, TrackingJobPrompt, TrackingJobResult } from './trackingProtocol'

/*
 * 一次跟踪（本地推理后台进程里运行，任务 4.10）：读已有结果 → 从覆盖范围的边界接着跟 → 写出合并后的结果。
 * - 结果是帧网格上连续的一段 [first, last]，提示帧是条件帧，其余是跟踪出来的；
 * - 续跟（“向前跟踪”“向前一帧”、停止后继续）时，记忆库按已存的掩码 logit 与目标指针重建（重算这几帧的图像特征），
 *   与一口气跟完只差 logit 的 int8 量化（1/4）；
 * - 停止（取消）时已跟踪的部分照样写出，下次接着跟。
 * 取帧、推理会话、读写文件由调用方注入，单测用替身跑完整流程。
 */

export interface TrackFrameRequest { first: number; count: number; width: number; height: number }

export interface TrackingDependencies {
  openModel(model: LocalInferenceModelFile, providers: readonly LocalExecutionProvider[], shape: string): Promise<LocalModelRunner>
  /** 帧网格上从 first 开始的 count 帧（RGB24，拉伸到 width × height）。 */
  frames(request: TrackFrameRequest): AsyncIterable<Uint8Array>
  readFile(path: string): Promise<Uint8Array | undefined>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  deflate(bytes: Uint8Array): Uint8Array
  inflate(bytes: Uint8Array): Uint8Array
  progress(done: number, total: number): void
  log: LocalInferenceLog
  signal: AbortSignal
  now?: () => number
}

export class TrackingError extends Error {
  constructor(readonly code: 'decode' | 'inference' | 'output' | 'cancelled', message: string, options?: { cause?: unknown }) { super(message, options); this.name = 'TrackingError' }
}

const CHUNK = 32
/** 物体框跟踪的解码尺寸：按显示比例，长边不超过 1280（搜索区缩到 256，大于这个尺寸收益很小）。 */
export function vitFrameSize(display: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(1, 1280 / Math.max(1, display.width, display.height))
  return { width: Math.max(16, Math.round(display.width * scale)), height: Math.max(16, Math.round(display.height * scale)) }
}

interface Stored { box: VideoEditTrackBox | null; record?: { logits: Float32Array; score: number; pointer: Float32Array } }

function modelOf(job: { models: LocalInferenceModelFile[] }, name: LocalInferenceModelName): LocalInferenceModelFile {
  const model = job.models.find(entry => entry.name === name)
  if (!model) throw new TrackingError('inference', `缺少模型 ${name}。`)
  return model
}

/** 读已有结果：方式、帧率、尺寸都对得上才用（否则当作没有，重新跟）。 */
function readExisting(job: TrackingJob, bytes: Uint8Array | undefined, inflate: (bytes: Uint8Array) => Uint8Array): Map<number, Stored> {
  const stored = new Map<number, Stored>()
  if (!bytes) return stored
  try {
    const layout = decodeSmartRegionLayout<VideoEditTrackHeader>(bytes)
    const header = layout.header
    if (header.kind !== 'track' || header.method !== job.method || header.fps !== job.fps) return stored
    for (let index = 0; index < header.frameCount; index++) {
      const entry: Stored = { box: header.boxes[index] ?? null }
      if (job.method === 'shape') {
        const frame = layout.frames[index]
        if (!frame) return new Map()
        const record = decodeVideoEditTrackRecord(inflate(bytes.subarray(layout.dataOffset + frame.offset, layout.dataOffset + frame.offset + frame.length)))
        entry.record = { logits: dequantizeVideoEditTrackLogits(record.logits), score: record.score, pointer: record.pointer }
      }
      stored.set(header.firstFrame + index, entry)
    }
  } catch { return new Map() }
  return stored
}

export async function runTracking(job: TrackingJob, deps: TrackingDependencies): Promise<TrackingJobResult> {
  const now = deps.now ?? (() => performance.now())
  const started = now()
  const timing = { decodeMs: 0, inferenceMs: 0 }
  const stored = readExisting(job, job.existingPath ? await deps.readFile(job.existingPath).catch(() => undefined) : undefined, deps.inflate)
  if (!job.prompts.length) throw new TrackingError('inference', '跟踪需要至少一个提示。')
  // 已有结果必须从第一个提示帧连着（提示改了时键就变了，不会读到别的定义的结果）。
  if (stored.size && !stored.has(Math.min(...job.prompts.map(prompt => prompt.frame)))) stored.clear()
  const before = stored.size
  const range = { first: Math.min(job.range.first, ...job.prompts.map(prompt => prompt.frame)), last: Math.max(job.range.last, ...job.prompts.map(prompt => prompt.frame)) }
  const frames = (request: TrackFrameRequest): AsyncIterable<Uint8Array> => deps.frames(request)
  const decodeOne = async (frame: number, width: number, height: number): Promise<Uint8Array> => {
    const waited = now()
    for await (const rgb of frames({ first: frame, count: 1, width, height })) { timing.decodeMs += now() - waited; return rgb }
    throw new TrackingError('decode', `素材第 ${frame} 帧解码不出画面。`)
  }
  /** 一个方向上逐帧走：按 32 帧一块解码（反向时块内倒序）；每帧交给 handle，取消时停下。 */
  const walk = async (from: number, to: number, direction: 1 | -1, width: number, height: number, handle: (frame: number, rgb: Uint8Array) => Promise<void>): Promise<boolean> => {
    let frame = from
    while (direction === 1 ? frame <= to : frame >= to) {
      const remaining = Math.abs(to - frame) + 1
      const count = Math.min(CHUNK, remaining)
      const first = direction === 1 ? frame : frame - count + 1
      const chunk: Uint8Array[] = []
      const waited = now()
      try { for await (const rgb of frames({ first, count, width, height })) { chunk.push(rgb); if (chunk.length >= count) break } }
      catch (error) { if (deps.signal.aborted) return true; throw error }
      if (deps.signal.aborted) return true
      timing.decodeMs += now() - waited
      if (!chunk.length) {
        // 素材尾之后没有画面（片段范围按整秒取整可能超出素材尾）：正向到此为止
        if (direction === 1 && frame > from) return false
        throw new TrackingError('decode', `素材第 ${first} 帧起解码不出画面。`)
      }
      // 反向时块内倒序；块比请求短说明素材在块里结束，结束之后的帧不存在，跳过。
      const order = chunk.map((_, index) => index); if (direction === -1) order.reverse()
      for (const index of order) {
        if (deps.signal.aborted) return true
        const current = first + index
        const working = now()
        await handle(current, chunk[index])
        timing.inferenceMs += now() - working
        deps.progress(Math.abs(current - from) + 1, Math.abs(to - from) + 1)
      }
      if (direction === 1 && chunk.length < count) return false
      frame = direction === 1 ? first + count : first - 1
    }
    return false
  }
  /** 已跟踪的连续一段：从第一个提示帧往两边连着的帧（后面的提示帧在跟到之前不算覆盖）。 */
  const anchor = Math.min(...job.prompts.map(prompt => prompt.frame))
  const span = (): { a: number; b: number } => {
    let a = anchor; let b = anchor
    while (stored.has(a - 1)) a--
    while (stored.has(b + 1)) b++
    return { a, b }
  }
  /** 要跟的两段：向后（b+1 → 目标）与向前（a−1 → 目标）。全新开始时从第一个提示帧往两边跟。 */
  const targets = (): { forward?: [number, number]; backward?: [number, number] } => {
    const current = span()
    const forwardEnd = Math.min(range.last, job.limit ? current.b + job.limit : range.last)
    const backwardEnd = Math.max(range.first, job.limit ? current.a - job.limit : range.first)
    return {
      ...(job.direction !== 'backward' && forwardEnd > current.b ? { forward: [current.b + 1, forwardEnd] as [number, number] } : {}),
      ...(job.direction !== 'forward' && backwardEnd < current.a ? { backward: [current.a - 1, backwardEnd] as [number, number] } : {}),
    }
  }

  let model: string; let provider: LocalExecutionProvider; let stopped = false
  if (job.method === 'box') ({ model, provider, stopped } = await trackBoxes(job, deps, stored, decodeOne, walk, targets))
  else ({ model, provider, stopped } = await trackShape(job, deps, stored, range, decodeOne, walk, targets))

  // 写出：从第一个提示帧连续生长的一段（还没跟到的后面的提示帧不写，下次重算）。
  const { a: first, b: last } = span()
  const boxes: Array<VideoEditTrackBox | null> = []; const records: Uint8Array[] = []
  let lost = 0
  for (let frame = first; frame <= last; frame++) {
    const entry = stored.get(frame)
    boxes.push(entry?.box ?? null); if (!entry?.box) lost++
    if (job.method === 'shape') {
      const record = entry?.record ?? { logits: new Float32Array(VIDEO_EDIT_TRACK_LOGIT_SIZE ** 2).fill(-32), score: -10, pointer: new Float32Array(256) }
      records.push(deps.deflate(encodeVideoEditTrackRecord(record)))
    }
  }
  const header = createVideoEditTrackHeader({
    method: job.method, model, fps: job.fps, firstFrame: first, frameCount: last - first + 1, sourceWidth: job.display.width, sourceHeight: job.display.height,
    promptFrames: job.prompts.map(prompt => prompt.frame), boxes, summary: { tracked: last - first + 1 - lost, lost },
    ...(job.method === 'shape' ? { logits: { width: VIDEO_EDIT_TRACK_LOGIT_SIZE, height: VIDEO_EDIT_TRACK_LOGIT_SIZE, scale: VIDEO_EDIT_TRACK_LOGIT_SCALE } } : {}),
  })
  try { await deps.writeFile(job.outputPath, encodeSmartRegionSegment(header, records)) }
  catch (error) { throw new TrackingError('output', '跟踪结果写入缓存失败。', { cause: error }) }
  return {
    model, provider, firstFrame: first, frameCount: last - first + 1, tracked: Math.max(0, last - first + 1 - before), stopped, summary: header.summary,
    decodeMs: Math.round(timing.decodeMs), inferenceMs: Math.round(timing.inferenceMs), durationMs: Math.round(now() - started),
  }
}

type Walk = (from: number, to: number, direction: 1 | -1, width: number, height: number, handle: (frame: number, rgb: Uint8Array) => Promise<void>) => Promise<boolean>
type Targets = () => { forward?: [number, number]; backward?: [number, number] }

// ==================== 物体框（VitTrack） ====================

async function trackBoxes(job: TrackingJob, deps: TrackingDependencies, stored: Map<number, Stored>, decodeOne: (frame: number, width: number, height: number) => Promise<Uint8Array>, walk: Walk, targets: Targets): Promise<{ model: string; provider: LocalExecutionProvider; stopped: boolean }> {
  const size = vitFrameSize(job.display)
  const runner = await deps.openModel(modelOf(job, 'vittrack'), job.providers, 'vittrack')
  const toRect = (box: readonly number[]): VitRect => ({ x: Math.round(box[0] * size.width), y: Math.round(box[1] * size.height), width: Math.max(1, Math.round(box[2] * size.width)), height: Math.max(1, Math.round(box[3] * size.height)) })
  const toBox = (rect: VitRect, score: number): VideoEditTrackBox => [rect.x / size.width, rect.y / size.height, rect.width / size.width, rect.height / size.height, Math.round(score * 1000) / 1000]
  const prompts = job.prompts
  const frameOf = (rgb: Uint8Array): VitFrame => ({ rgb, width: size.width, height: size.height })
  const tracker = new VitTracker(runner)
  // 全新开始：第一个提示帧就是起点
  if (!stored.size) stored.set(prompts[0].frame, { box: toBox(toRect(prompts[0].box!), 1) })
  let stopped = false
  const plan = targets()
  /** 续跟时找最近一次跟到的框（OpenCV 跟丢时保留上一次的框继续找）。 */
  const lastFound = (from: number, step: 1 | -1, until: number): VitRect | undefined => {
    for (let frame = from; step === 1 ? frame <= until : frame >= until; frame += step) { const box = stored.get(frame)?.box; if (box) return toRect(box) }
    return undefined
  }
  if (plan.forward) {
    const [from, to] = plan.forward
    let governing = [...prompts].reverse().find(prompt => prompt.frame < from) ?? prompts[0]
    const start = async (prompt: TrackingJobPrompt, last: VitRect | undefined): Promise<void> => {
      const rgb = await decodeOne(prompt.frame, size.width, size.height)
      if (last) tracker.resume(frameOf(rgb), toRect(prompt.box!), last); else tracker.init(frameOf(rgb), toRect(prompt.box!))
    }
    await start(governing, lastFound(from - 1, -1, governing.frame))
    stopped = await walk(from, to, 1, size.width, size.height, async (frame, rgb) => {
      const prompt = prompts.find(entry => entry.frame === frame)
      if (prompt) { governing = prompt; tracker.init(frameOf(rgb), toRect(prompt.box!)); stored.set(frame, { box: toBox(toRect(prompt.box!), 1) }); return }
      const result = await tracker.update(frameOf(rgb))
      stored.set(frame, { box: result.box ? toBox(result.box, result.score) : null })
    })
  }
  if (plan.backward && !stopped) {
    const [from, to] = plan.backward
    // 第一个提示帧之前只有一种走法：从第一个提示帧倒着跟
    const rgb = await decodeOne(prompts[0].frame, size.width, size.height)
    const last = lastFound(from + 1, 1, prompts[0].frame)
    if (last) tracker.resume(frameOf(rgb), toRect(prompts[0].box!), last); else tracker.init(frameOf(rgb), toRect(prompts[0].box!))
    stopped = await walk(from, to, -1, size.width, size.height, async (frame, image) => {
      const result = await tracker.update(frameOf(image))
      stored.set(frame, { box: result.box ? toBox(result.box, result.score) : null })
    })
  }
  return { model: 'vittrack', provider: runner.provider, stopped }
}

// ==================== 形状（EfficientTAM） ====================

export function etamParts(job: { models: LocalInferenceModelFile[]; providers: LocalExecutionProvider[] }, deps: Pick<TrackingDependencies, 'openModel'>): Promise<{ session: EfficientTamSession; provider: LocalExecutionProvider }> {
  const open = (name: LocalInferenceModelName): Promise<LocalModelRunner> => deps.openModel(name === 'etam_mask_decoder'
    ? { ...modelOf(job, name), extraOutputs: [{ name: ETAM_CANDIDATES_OUTPUT, elementType: 1, dims: [1, 4, 128, 128] }] }
    : modelOf(job, name), job.providers, 'etam-512')
  return Promise.all([open('etam_image_encoder'), open('etam_mask_decoder'), open('etam_memory_encoder'), open('etam_memory_attention'), open('etam_mask_downsample')])
    .then(([imageEncoder, maskDecoder, memoryEncoder, memoryAttention, maskDownsample]) => ({ session: new EfficientTamSession({ imageEncoder, maskDecoder, memoryEncoder, memoryAttention, maskDownsample }), provider: imageEncoder.provider }))
}

const boxOf = (result: EtamFrameResult): VideoEditTrackBox | null => result.score > 0 ? videoEditTrackLogitBox(result.logits, VIDEO_EDIT_TRACK_LOGIT_SIZE, VIDEO_EDIT_TRACK_LOGIT_SIZE, Math.round(Math.min(1, 1 / (1 + Math.exp(-result.score))) * 1000) / 1000) : null

async function trackShape(job: TrackingJob, deps: TrackingDependencies, stored: Map<number, Stored>, range: { first: number; last: number }, decodeOne: (frame: number, width: number, height: number) => Promise<Uint8Array>, walk: Walk, targets: Targets): Promise<{ model: string; provider: LocalExecutionProvider; stopped: boolean }> {
  const { session, provider } = await etamParts(job, deps)
  // 条件帧：每个提示帧都重算（便宜：每帧一次图像编码、解码、记忆编码），结果覆盖已存的同一帧。
  const cond = new Map<number, { result: EtamFrameResult; memory: Float32Array }>()
  for (const prompt of job.prompts) {
    const features = await session.encode(await decodeOne(prompt.frame, ETAM_IMAGE_SIZE, ETAM_IMAGE_SIZE))
    const result = await session.prompt(features, etamPromptFromNormalized(prompt))
    cond.set(prompt.frame, { result, memory: await session.encodeMemory(features, result, true) })
    stored.set(prompt.frame, { box: boxOf(result), record: { logits: result.logits, score: result.score, pointer: result.pointer } })
    if (deps.signal.aborted) return { model: 'efficienttam', provider, stopped: true }
  }
  const condFrames = [...cond.keys()]
  const nonCond = (frame: number): boolean => stored.has(frame) && !cond.has(frame)
  /** 跟踪帧的记忆：本次算过的直接用，续跟时按已存 logit 重建（需要那一帧的图像特征）。 */
  const memories = new Map<number, Float32Array>()
  const rebuild = async (frames: number[]): Promise<void> => {
    const missing = frames.filter(frame => nonCond(frame) && !memories.has(frame)).sort((a, b) => a - b)
    for (const frame of missing) {
      const features = await session.encode(await decodeOne(frame, ETAM_IMAGE_SIZE, ETAM_IMAGE_SIZE))
      const record = stored.get(frame)!.record!
      memories.set(frame, await session.encodeMemory(features, record, false))
    }
  }
  const step = async (frame: number, direction: 1 | -1, rgb: Uint8Array): Promise<void> => {
    if (cond.has(frame)) return
    const features: EtamFeatures = await session.encode(rgb)
    const plan = etamMemoryPlan(frame, direction, condFrames, nonCond, range)
    await rebuild(plan.memory.map(entry => entry.frame).filter(entry => !cond.has(entry)))
    const result = await session.track(features,
      plan.memory.map(entry => ({ memory: cond.get(entry.frame)?.memory ?? memories.get(entry.frame)!, tpos: entry.tpos })),
      plan.pointers.map(entry => cond.get(entry)?.result.pointer ?? stored.get(entry)!.record!.pointer))
    memories.set(frame, await session.encodeMemory(features, result, false))
    stored.set(frame, { box: boxOf(result), record: { logits: result.logits, score: result.score, pointer: result.pointer } })
    // 用不到的旧记忆丢掉（只看方向上最近 6 帧）
    for (const key of memories.keys()) if (Math.abs(key - frame) > 6) memories.delete(key)
  }
  const plan = targets()
  let stopped = false
  if (plan.forward) stopped = await walk(plan.forward[0], plan.forward[1], 1, ETAM_IMAGE_SIZE, ETAM_IMAGE_SIZE, (frame, rgb) => step(frame, 1, rgb))
  if (plan.backward && !stopped) { memories.clear(); stopped = await walk(plan.backward[0], plan.backward[1], -1, ETAM_IMAGE_SIZE, ETAM_IMAGE_SIZE, (frame, rgb) => step(frame, -1, rgb)) }
  return { model: 'efficienttam', provider, stopped }
}

// ==================== 点选候选 ====================

/** 点一个点：3 个候选掩码（多掩码输出），界面让用户挑。 */
export async function runTrackingCandidates(job: TrackingCandidatesJob, deps: Pick<TrackingDependencies, 'openModel' | 'frames'>): Promise<TrackingCandidatesResult> {
  const { session, provider } = await etamParts(job, deps)
  let rgb: Uint8Array | undefined
  for await (const frame of deps.frames({ first: job.frame, count: 1, width: ETAM_IMAGE_SIZE, height: ETAM_IMAGE_SIZE })) { rgb = frame; break }
  if (!rgb) throw new TrackingError('decode', '这一帧解码不出画面。')
  const result = await session.prompt(await session.encode(rgb), etamPromptFromNormalized({ points: job.points }))
  if (!result.candidates || !result.candidateScores) throw new TrackingError('inference', '模型没有给出候选掩码。')
  return { provider, size: VIDEO_EDIT_TRACK_LOGIT_SIZE, candidates: result.candidates.map((logits, index) => ({ logits: quantizeVideoEditTrackLogits(logits), score: Math.round(result.candidateScores![index] * 1000) / 1000 })) }
}
