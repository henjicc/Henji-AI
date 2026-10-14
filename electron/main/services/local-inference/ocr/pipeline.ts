import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { sensitiveTextMatches, type PrivacyCandidate, type PrivacyBox } from '../../../../../src/core/screenRecording/privacy'
import type { SmartRegionAnalysisDependencies, LocalTensorOutput } from '../analysis'
import { ppocrInput, textBoxesFromMap } from '../analyzers/textDetection'
import { decodeRecognition, recognitionInput } from './recognition'
import type { OcrPrivacyJob, OcrPrivacyResult } from './protocol'

export interface OcrPrivacyDependencies extends Pick<SmartRegionAnalysisDependencies, 'openModel' | 'frames' | 'signal' | 'progress'> { alphabet: readonly string[] }
function equalFrame(a: Uint8Array | undefined, b: Uint8Array): boolean { return Boolean(a && a.length === b.length && a.every((v, i) => v === b[i])) }
function tensor(outputs: Record<string, LocalTensorOutput>): LocalTensorOutput { const out = Object.values(outputs)[0]; if (!out) throw new Error('文字识别模型没有输出。'); return out }
export async function runOcrPrivacy(job: OcrPrivacyJob, deps: OcrPrivacyDependencies): Promise<OcrPrivacyResult> {
  deps.signal.throwIfAborted()
  const scale = Math.min(1, 1920 / Math.max(job.display.width, job.display.height))
  const size = { width: Math.max(1, Math.round(job.display.width * scale)), height: Math.max(1, Math.round(job.display.height * scale)) }
  const ds = 1280 / Math.max(size.width, size.height), align = (v: number): number => Math.max(32, Math.round(v * ds / 32) * 32)
  const detSize = { width: align(size.width), height: align(size.height) }
  const det = job.models.find(m => m.name === 'ppocr'), rec = job.models.find(m => m.name === 'ppocr_rec')
  if (!det || !rec) throw new Error('请下载文字检测和文字识别模型后重试。')
  const detector = await deps.openModel(det, job.providers, `${detSize.width}x${detSize.height}`)
  const candidates: PrivacyCandidate[] = []
  let previous: Uint8Array | undefined, active: PrivacyCandidate[] = [], frames = 0, inferredFrames = 0
  const total = Math.ceil(job.durationSeconds * job.fps), stepUs = Math.round(1e6 / job.fps)
  for await (const rgb of deps.frames(size)) {
    deps.signal.throwIfAborted()
    if (rgb.length !== size.width * size.height * 3) throw new Error('文字识别取帧大小不符。')
    const monoUs = job.startUs + Math.round(frames * 1e6 / job.fps)
    if (monoUs >= job.endUs) break
    const endUs = Math.min(job.endUs, monoUs + stepUs)
    if (equalFrame(previous, rgb)) active.forEach(c => { c.endUs = endUs })
    else {
      inferredFrames++
      const resized = await sharp(rgb, { raw: { ...size, channels: 3 } }).resize(detSize.width, detSize.height, { fit: 'fill', kernel: 'linear' }).raw().toBuffer()
      const output = tensor(await detector.run({ x: { type: 'float32', data: ppocrInput(resized, detSize.width, detSize.height), dims: [1, 3, detSize.height, detSize.width] } }))
      if (!(output.data instanceof Float32Array) || output.data.length !== detSize.width * detSize.height) throw new Error('文字检测输出大小不符。')
      const next: PrivacyCandidate[] = []
      for (const detected of textBoxesFromMap(output.data, detSize.width, detSize.height)) {
        deps.signal.throwIfAborted()
        const box = detected.slice(0, 4) as PrivacyBox, input = await recognitionInput(rgb, size.width, size.height, box)
        const recognizer = await deps.openModel(rec, job.providers, `${input.width}x48`)
        const recognized = decodeRecognition(tensor(await recognizer.run({ x: { type: 'float32', data: input.data, dims: [1, 3, 48, input.width] } })), deps.alphabet)
        deps.signal.throwIfAborted()
        if (recognized.confidence < 0.5) continue
        for (const match of sensitiveTextMatches(recognized.text)) {
          const fingerprint = createHash('sha256').update(`${job.id}:${match.kind}:${match.value}`).digest('hex')
          const distance = (c: PrivacyCandidate): number => { const last = c.samples.at(-1)!.box; return Math.hypot(last[0] + last[2] / 2 - box[0] - box[2] / 2, last[1] + last[3] / 2 - box[1] - box[3] / 2) }
          const existing = active.filter(c => c.fingerprint === fingerprint && !next.includes(c) && distance(c) < 0.35).sort((a, b) => distance(a) - distance(b))[0]
          // The entire detected line is protected; estimating character boxes can leave a key readable.
          const candidate = existing ?? { id: `${job.id}:${candidates.length}`, mediaId: job.mediaId, kind: match.kind, hint: `${match.kind} · ••••`, fingerprint, startUs: monoUs, endUs, status: 'pending', samples: [] } as PrivacyCandidate
          if (!existing) candidates.push(candidate)
          const last = candidate.samples.at(-1)
          if (!last || JSON.stringify(last.box) !== JSON.stringify(box)) {
            // RLE static intervals end at the preceding sample, so a later move does not mask the whole earlier still interval.
            const previousUs = candidate.endUs - stepUs
            if (last && previousUs > last.monoUs && previousUs < monoUs) candidate.samples.push({ ...last, monoUs: previousUs })
            candidate.samples.push({ monoUs, box, confidence: recognized.confidence })
          }
          candidate.endUs = endUs
          next.push(candidate)
        }
      }
      active = next
    }
    previous = rgb; frames++; deps.progress(Math.min(total, frames), total)
  }
  deps.signal.throwIfAborted()
  if (!frames) throw new Error('录制没有可识别的画面。')
  return { privacy: { candidates, warnings: ['敏感信息按每秒十帧检查；请复核快速滚动、短暂闪现、旋转文字及低清文字。确认后才启用打码。'] }, frames, inferredFrames }
}
