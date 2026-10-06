import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { decodeSmartRegionLayout } from '../../../../../src/core/videoEdit/smartRegions'
import { decodeVideoEditTrackRecord, dequantizeVideoEditTrackLogits, type VideoEditTrackHeader } from '../../../../../src/core/videoEdit/tracking'
import { LocalModelSessions, loadOnnxRuntime } from '../onnxRuntime'
import type { LocalInferenceModelFile } from '../protocol'
import type { LocalExecutionProvider } from '../providers'
import { runTracking, type TrackFrameRequest } from './trackJob'
import type { TrackingJob } from './trackingProtocol'

/**
 * 形状跟踪的 TypeScript 循环与导出方参考实现（henji-model-export/scripts/track_onnx.py，onnxruntime CPU fp32）逐帧对照（任务 4.10）。
 * 需要模型与参考数据，不进普通单测：
 *   HENJI_TRACKING_MODELS=D:\VibeCode\henji-ai-local-models HENJI_TRACKING_REFERENCE=<dump_reference.py 的输出目录> \
 *   npx vitest run electron/main/services/local-inference/tracking/tracking.native.test.ts
 * 参考数据：每个案例目录有 frames.u8（N×512×512×3，与参考实现同一份 PIL 缩放结果）、logits.f32（N×128×128）、meta.json（提示）。
 * 另设 HENJI_TRACKING_PROVIDER=dml 用 DirectML 跑（默认 CPU，与参考同一执行器，用于数值对照）。
 */
const MODELS = process.env.HENJI_TRACKING_MODELS
const REFERENCE = process.env.HENJI_TRACKING_REFERENCE
const PROVIDER = (process.env.HENJI_TRACKING_PROVIDER ?? 'cpu') as LocalExecutionProvider
const PARTS: Array<[LocalInferenceModelFile['name'], string]> = [
  ['etam_image_encoder', 'image_encoder'], ['etam_mask_decoder', 'mask_decoder'], ['etam_memory_encoder', 'memory_encoder'],
  ['etam_memory_attention', 'memory_attention'], ['etam_mask_downsample', 'mask_downsample'],
]

describe.skipIf(!MODELS || !REFERENCE)('形状跟踪：TypeScript 循环与参考实现逐帧对照（真实 onnxruntime-node）', () => {
  const temporary = path.join(os.tmpdir(), `henji-tracking-${process.pid}`)
  let sessions: LocalModelSessions | undefined
  afterAll(async () => { await sessions?.dispose(); await fs.rm(temporary, { recursive: true, force: true }) })

  async function load(name: string) {
    const dir = path.join(REFERENCE!, name)
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as { frames: number; width: number; height: number; prompt: { points?: Array<[number, number, 0 | 1]>; box?: [number, number, number, number] } }
    const frames = new Uint8Array(await fs.readFile(path.join(dir, 'frames.u8')))
    const raw = await fs.readFile(path.join(dir, 'logits.f32'))
    const logits = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    return { meta, frames, logits }
  }

  async function track(name: string, steps: Array<{ direction: TrackingJob['direction']; limit?: number }>) {
    const { meta, frames, logits } = await load(name)
    sessions ??= new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    const pool = sessions
    await fs.mkdir(temporary, { recursive: true })
    const frameBytes = 512 * 512 * 3
    const output = path.join(temporary, `${name}.htrk`)
    let existing: string | undefined
    const timings: number[] = []
    for (const [index, step] of steps.entries()) {
      const job: TrackingJob = {
        id: `${name}-${index}`, method: 'shape', models: PARTS.map(([part, file]) => ({ name: part, path: path.join(MODELS!, 'object_segmentation_efficienttam', `efficienttam_ti_512_${file}.onnx`) })),
        ffmpegPath: '', source: name, containerStartUs: 0, fps: 30, display: { width: meta.width, height: meta.height },
        prompts: [{ frame: 0, ...meta.prompt }], range: { first: 0, last: meta.frames - 1 }, direction: step.direction, ...(step.limit ? { limit: step.limit } : {}),
        ...(existing ? { existingPath: existing } : {}), outputPath: `${output}.${index}`, providers: [PROVIDER],
      }
      const result = await runTracking(job, {
        openModel: (model, providers, shape) => pool.open(model, providers, shape),
        // 帧直接取参考实现用的同一份 512×512 画面（不经过 FFmpeg），只对照跟踪循环本身。
        frames: async function* (request: TrackFrameRequest) { for (let frame = request.first; frame < Math.min(meta.frames, request.first + request.count); frame++) yield frames.subarray(frame * frameBytes, (frame + 1) * frameBytes) },
        readFile: file => fs.readFile(file).then(buffer => new Uint8Array(buffer)), writeFile: (file, bytes) => fs.writeFile(file, bytes),
        deflate: bytes => deflateRawSync(bytes), inflate: bytes => new Uint8Array(inflateRawSync(bytes)),
        progress: () => undefined, log: () => undefined, signal: new AbortController().signal,
      })
      timings.push(result.inferenceMs / Math.max(1, result.tracked))
      existing = job.outputPath
    }
    const bytes = new Uint8Array(await fs.readFile(existing!))
    const layout = decodeSmartRegionLayout<VideoEditTrackHeader>(bytes)
    const ious: number[] = []; let maxAbs = 0
    for (let frame = 0; frame < layout.header.frameCount; frame++) {
      const entry = layout.frames[frame]
      const ours = dequantizeVideoEditTrackLogits(decodeVideoEditTrackRecord(new Uint8Array(inflateRawSync(bytes.subarray(layout.dataOffset + entry.offset, layout.dataOffset + entry.offset + entry.length)))).logits)
      const reference = logits.subarray(frame * 128 * 128, (frame + 1) * 128 * 128)
      let union = 0; let both = 0
      // 结果文件里的 logit 按 1/4 量化：参考值按同样规则量化后比较正负（原始值的差别另看 maxAbs，应不超过量化半步 0.125）。
      for (let index = 0; index < ours.length; index++) {
        const a = ours[index] > 0; const b = Math.max(-127, Math.min(127, Math.round(reference[index] * 4))) > 0
        if (a || b) union++; if (a && b) both++
        if (Math.abs(reference[index]) < 30) maxAbs = Math.max(maxAbs, Math.abs(ours[index] - reference[index]))
      }
      ious.push(union ? both / union : 1)
    }
    return { header: layout.header, ious, maxAbs, timings }
  }

  it.each(['synth_box', 'car_pt', 'juggle_person'])('%s：一口气跟完，逐帧掩码与参考一致', async (name) => {
    const { header, ious, maxAbs, timings } = await track(name, [{ direction: 'both' }])
    const mean = ious.reduce((sum, value) => sum + value, 0) / ious.length
    // eslint-disable-next-line no-console -- 显式实测命令的输出就是实测数据
    console.info(`[tracking] ${name} ${PROVIDER} frames=${header.frameCount} meanIoU=${mean.toFixed(5)} minIoU=${Math.min(...ious).toFixed(4)} maxAbsLogit=${maxAbs.toFixed(3)} msPerFrame=${timings[0].toFixed(1)}`)
    expect(header.frameCount).toBe(ious.length)
    expect(mean).toBeGreaterThan(PROVIDER === 'cpu' ? 0.999 : 0.99)
    expect(Math.min(...ious)).toBeGreaterThan(PROVIDER === 'cpu' ? 0.99 : 0.95)
  }, 600_000)

  it('续跟：先跟 1 帧、再跟 9 帧、再跟完，与一口气跟完的参考相差只在 logit 量化', async () => {
    const { ious } = await track('synth_box', [{ direction: 'forward', limit: 1 }, { direction: 'forward', limit: 9 }, { direction: 'forward' }])
    const mean = ious.reduce((sum, value) => sum + value, 0) / ious.length
    // eslint-disable-next-line no-console -- 显式实测命令的输出就是实测数据
    console.info(`[tracking] synth_box resumed meanIoU=${mean.toFixed(5)} minIoU=${Math.min(...ious).toFixed(4)}`)
    expect(mean).toBeGreaterThan(0.995)
  }, 600_000)
})

/**
 * 物体框跟踪 VitTrack 与 Python 参考（OpenCV 4.12 TrackerVit 流程 + ImageNet 归一化 + onnxruntime CPU）逐帧对照，合成视频另与真值框比 IoU：
 *   HENJI_TRACKING_MODELS=... HENJI_VITTRACK_REFERENCE=<dump_vittrack.py 的输出目录> npx vitest run …/tracking.native.test.ts
 */
const VIT_REFERENCE = process.env.HENJI_VITTRACK_REFERENCE
describe.skipIf(!MODELS || !VIT_REFERENCE)('物体框跟踪：VitTrack 与参考实现逐帧对照', () => {
  it.each(['car', 'juggle', 'synth'])('%s', async (name) => {
    const { VitTracker } = await import('./vitTrack')
    const dir = path.join(VIT_REFERENCE!, name)
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as { frames: number; width: number; height: number; box: [number, number, number, number]; boxes: Array<[number, number, number, number, number] | null>; gt: Array<[number, number, number, number] | null> | null }
    const frames = new Uint8Array(await fs.readFile(path.join(dir, 'frames.u8')))
    const pool = new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
    const runner = await pool.open({ name: 'vittrack', path: path.join(MODELS!, 'object_tracking_vittrack', 'object_tracking_vittrack_2023sep.onnx') }, [PROVIDER], 'vittrack')
    const size = meta.width * meta.height * 3
    const frame = (index: number) => ({ rgb: frames.subarray(index * size, (index + 1) * size), width: meta.width, height: meta.height })
    const tracker = new VitTracker(runner)
    tracker.init(frame(0), { x: meta.box[0], y: meta.box[1], width: meta.box[2], height: meta.box[3] })
    let maxDelta = 0; let exact = 0; let elapsed = 0; const ious: number[] = []
    const iou = (a: { x: number; y: number; width: number; height: number }, b: readonly number[]): number => {
      const w = Math.max(0, Math.min(a.x + a.width, b[0] + b[2]) - Math.max(a.x, b[0])); const h = Math.max(0, Math.min(a.y + a.height, b[1] + b[3]) - Math.max(a.y, b[1]))
      return w * h / (a.width * a.height + b[2] * b[3] - w * h)
    }
    // 整段连续跟踪：与真值比 IoU（合成视频），记录耗时
    for (let index = 1; index < meta.frames; index++) {
      const started = performance.now()
      await tracker.update(frame(index))
      elapsed += performance.now() - started
      const truth = meta.gt?.[index]; if (truth && tracker.current) ious.push(iou(tracker.current, truth))
    }
    // 逐帧对照：每一帧都从参考的上一帧框出发（跟踪是混沌的，缩放取整的 1 级灰度差会一路放大，逐帧比才看得出实现是否一致）
    const prompt = { x: meta.box[0], y: meta.box[1], width: meta.box[2], height: meta.box[3] }
    for (let index = 1; index < meta.frames; index++) {
      const previous = meta.boxes[index - 1]
      if (!previous) continue
      tracker.resume(frame(0), prompt, { x: previous[0], y: previous[1], width: previous[2], height: previous[3] })
      const result = await tracker.update(frame(index))
      const expected = meta.boxes[index]
      expect(Boolean(result.box)).toBe(Boolean(expected))
      if (!result.box || !expected) continue
      const delta = Math.max(Math.abs(result.box.x - expected[0]), Math.abs(result.box.y - expected[1]), Math.abs(result.box.width - expected[2]), Math.abs(result.box.height - expected[3]))
      // eslint-disable-next-line no-console -- 显式实测命令的逐帧输出
      if (process.env.HENJI_TRACKING_VERBOSE) console.info(index, delta, [result.box.x, result.box.y, result.box.width, result.box.height], expected)
      maxDelta = Math.max(maxDelta, delta); if (!delta) exact++
    }
    const truthIoU = ious.length ? ious.reduce((sum, value) => sum + value, 0) / ious.length : undefined
    // eslint-disable-next-line no-console -- 显式实测命令的输出就是实测数据
    console.info(`[vittrack] ${name} ${PROVIDER} frames=${meta.frames} exact=${exact}/${meta.frames - 1} maxDeltaPx=${maxDelta} msPerFrame=${(elapsed / (meta.frames - 1)).toFixed(2)}${truthIoU !== undefined ? ` truthIoU=${truthIoU.toFixed(3)}` : ''}`)
    if (truthIoU !== undefined) expect(truthIoU).toBeGreaterThan(0.75)
    await pool.dispose()
    // cv2.resize 的 8 位线性缩放是定点运算，与这里的浮点实现偶有 1 级灰度差，单帧的框最多差几个像素。
    expect(maxDelta).toBeLessThanOrEqual(4)
    expect(exact / (meta.frames - 1)).toBeGreaterThan(0.3)
  }, 300_000)
})
