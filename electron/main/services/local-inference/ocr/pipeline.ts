import { createHash } from 'node:crypto'
import { sensitiveTextMatches, type PrivacyCandidate, type PrivacyBox } from '../../../../../src/core/screenRecording/privacy'
import type { SmartRegionAnalysisDependencies } from '../analysis'
import { ppocrInputSize } from '../analyzers/textDetection'
import { FrameOcr } from './frameOcr'
import { changedTiles } from './frameChanges'
import type { OcrPrivacyJob, OcrPrivacyResult } from './protocol'

export interface OcrPrivacyDependencies extends Pick<SmartRegionAnalysisDependencies, 'openModel' | 'frames' | 'signal' | 'progress'> { alphabet: readonly string[] }
export async function runOcrPrivacy(job: OcrPrivacyJob, deps: OcrPrivacyDependencies): Promise<OcrPrivacyResult> {
  deps.signal.throwIfAborted()
  const size = job.display, detSize = ppocrInputSize(size.width, size.height)
  const det = job.models.find(m => m.name === 'ppocr'), rec = job.models.find(m => m.name === 'ppocr_rec')
  if (!det || !rec) throw new Error('请下载文字检测和文字识别模型后重试。')
  const detector = await deps.openModel(det, job.providers, `${detSize.width}x${detSize.height}`, { intraOpNumThreads: 4 })
  const recognizer = await deps.openModel(rec, ['cpu'], 'dynamic', { intraOpNumThreads: 4 })
  const ocr = new FrameOcr(detector, recognizer, deps.alphabet, job.normalization)
  const candidates: PrivacyCandidate[] = []
  let previous: Uint8Array | undefined, active: PrivacyCandidate[] = [], frames = 0, inferredFrames = 0
  let cursorIndex = -1, previousCursor: [number, number] | null = null
  const cursor = job.cursor ?? []
  const total = Math.ceil(job.durationSeconds * job.fps), stepUs = Math.round(1e6 / job.fps)
  for await (const rgb of deps.frames(size)) {
    deps.signal.throwIfAborted()
    if (rgb.length !== size.width * size.height * 3) throw new Error('文字识别取帧大小不符。')
    const monoUs = job.startUs + Math.round(frames * 1e6 / job.fps)
    if (monoUs >= job.endUs) break
    const endUs = Math.min(job.endUs, monoUs + stepUs)
    while (cursorIndex + 1 < cursor.length && cursor[cursorIndex + 1].monoUs <= monoUs) cursorIndex++
    const point = cursorIndex >= 0 ? cursor[cursorIndex].point : null
    const changes = changedTiles(previous, rgb, size.width, size.height, [previousCursor, point].filter((p): p is [number, number] => p !== null))
    // Revisit masked pixels every second: typing beneath a stationary pointer must not remain hidden.
    if (cursor.length && frames % Math.max(1, Math.round(job.fps)) === 0) changes.push([0, 0, 1, 1])
    if (!changes.length) active.forEach(c => { c.endUs = endUs })
    else {
      inferredFrames++
      const result = await ocr.run(rgb, size.width, size.height, deps.signal, changes)
      const next: PrivacyCandidate[] = []
      for (const recognized of result.lines) {
        const box: PrivacyBox = recognized.box
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
    previous = rgb; previousCursor = point; frames++; deps.progress(Math.min(total, frames), total)
  }
  deps.signal.throwIfAborted()
  if (!frames) throw new Error('录制没有可识别的画面。')
  return { privacy: { candidates, warnings: ['敏感信息按每秒十帧检查；请复核快速滚动、短暂闪现、旋转文字及低清文字。确认后才启用打码。'] }, frames, inferredFrames }
}
