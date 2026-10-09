import { loadSharp } from '../../image/sharp-loader'
import { encodeImageEditSelectionMaskV3 } from '../../../../../src/core/imageEdit/v3/subjectSelection'
import type { ImageEditorV3SubjectCandidate } from '../../../../../src/platform/contracts/imageEditorV3'
import type { LocalModelRunner, SmartRegionAnalysisDependencies, LocalTensorInput } from '../analysis'
import { EfficientTamImageSession, etamPromptFromNormalized, etamUpsampleBinary, ETAM_CANDIDATES_OUTPUT } from '../tracking/efficientTam'
import { rvmInputSize, rvmSourceTensor, rvmMatte, RVM_DOWNSAMPLE_RATIO, selfieInput, selfieMatte } from '../analyzers/matting'
import type { ImageSubjectSelectionJob, ImageSubjectSelectionResult } from './protocol'

/** 候选按掩码重叠消重；保留全部不同主体，不按候选数量截断。 */
export function distinctSubjectCandidates(candidates: ImageEditorV3SubjectCandidate[]): ImageEditorV3SubjectCandidate[] {
  const masks = new Map<ImageEditorV3SubjectCandidate, Uint8Array>()
  const bytes = (candidate: ImageEditorV3SubjectCandidate): Uint8Array => {
    let data = masks.get(candidate)
    if (!data) { data = new Uint8Array(candidate.mask.width * candidate.mask.height); for (const [start, length, value] of candidate.mask.runs) if (value >= 128) data.fill(1, start, start + length); masks.set(candidate, data) }
    return data
  }
  const kept: ImageEditorV3SubjectCandidate[] = []
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const a = bytes(candidate)
    if (kept.some(other => { const b = bytes(other); let intersection = 0, union = 0; for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) intersection++; if (a[i] || b[i]) union++ } return union > 0 && intersection / union > 0.8 })) continue
    kept.push(candidate)
  }
  return kept.map((candidate, index) => ({ ...candidate, id: String(index + 1) }))
}

export function subjectCandidate(bytes: Uint8Array, width: number, height: number, score = 1): ImageEditorV3SubjectCandidate | null {
  let left = width, top = height, right = 0, bottom = 0, sum = 0
  for (let i = 0; i < bytes.length; i++) { sum += bytes[i] / 255; if (bytes[i] >= 128) { const x = i % width, y = Math.floor(i / width); left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1) } }
  if (right <= left || bottom <= top) return null
  return { id: '', mask: encodeImageEditSelectionMaskV3(bytes, width, height), score: Number.isFinite(score) ? score : 0, area: sum / bytes.length,
    bounds: { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height } }
}

/** 人像分割的连通区域是候选而非身份；抑制极弱背景后保留候选的软覆盖率。 */
export function portraitCandidates(bytes: Uint8Array, width: number, height: number): ImageEditorV3SubjectCandidate[] {
  const labels = new Int32Array(bytes.length), queue = new Int32Array(bytes.length), candidates: ImageEditorV3SubjectCandidate[] = []
  let label = 0
  for (let i = 0; i < bytes.length; i++) {
    if (labels[i] || bytes[i] < 16) continue
    let head = 0, tail = 1; queue[0] = i; labels[i] = ++label
    while (head < tail) {
      const p = queue[head++], x = p % width
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q >= 0 && q < bytes.length && !labels[q] && bytes[q] >= 16) { labels[q] = label; queue[tail++] = q }
      }
    }
    let weight = 0
    for (let j = 0; j < tail; j++) weight += bytes[queue[j]] / 255
    if (weight / bytes.length < 0.002) continue
    const mask = new Uint8Array(bytes.length)
    for (let j = 0; j < tail; j++) mask[queue[j]] = bytes[queue[j]]
    const candidate = subjectCandidate(mask, width, height)
    // 低于模型像素分辨率的孤立噪声不是可可靠定位的主体。
    if (candidate && candidate.area >= 0.002) candidates.push({ ...candidate, id: String(candidates.length + 1) })
  }
  return candidates
}

export async function runImageSubjectSelection(job: ImageSubjectSelectionJob, deps: Pick<SmartRegionAnalysisDependencies, 'openModel' | 'signal' | 'log' | 'progress'>): Promise<ImageSubjectSelectionResult> {
  const begun = performance.now(), sharp = await loadSharp()
  const resize = async (width: number, height: number): Promise<Uint8Array> => new Uint8Array(await sharp(Buffer.from(job.rgba), { raw: { width: job.width, height: job.height, channels: 4 } }).removeAlpha().resize(width, height, { fit: 'fill' }).raw().toBuffer())
  const open = async (name: ImageSubjectSelectionJob['models'][number]['name'], shape: string): Promise<LocalModelRunner> => {
    deps.signal.throwIfAborted()
    const file = job.models.find(entry => entry.name === name)
    if (!file) throw new Error(`主体选择模型 ${name} 未就绪`)
    return deps.openModel(name === 'etam_mask_decoder' ? { ...file, extraOutputs: [{ name: ETAM_CANDIDATES_OUTPUT, elementType: 1, dims: [1, 4, 128, 128] }] } : file, job.providers, shape)
  }
  let candidates: ImageEditorV3SubjectCandidate[], model: ImageSubjectSelectionResult['model'], inferenceMs = 0, runners: LocalModelRunner[] = []
  const visible = async (bytes: Uint8Array, width: number, height: number): Promise<Uint8Array> => {
    const alpha = await sharp(Buffer.from(job.rgba), { raw: { width: job.width, height: job.height, channels: 4 } }).extractChannel(3).resize(width, height, { fit: 'fill' }).raw().toBuffer()
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(bytes[i] * alpha[i] / 255)
    return bytes
  }
  if (job.region.kind === 'portrait') {
    const runPortrait = async (name: 'rvm' | 'selfie'): Promise<{ bytes: Uint8Array; width: number; height: number }> => {
      const size = name === 'rvm' ? rvmInputSize(job.width, job.height) : { width: 256, height: 256 }
      const runner = await open(name, `${size.width}x${size.height}`), rgb = await resize(size.width, size.height)
      const started = performance.now()
      let bytes: Uint8Array
      if (name === 'rvm') {
        const zero = (): LocalTensorInput => ({ type: 'float16', data: new Uint16Array(1), dims: [1, 1, 1, 1] })
        const result = await runner.run({ src: { type: 'float16', data: rvmSourceTensor(rgb, size.width, size.height), dims: [1, 3, size.height, size.width] }, r1i: zero(), r2i: zero(), r3i: zero(), r4i: zero(), downsample_ratio: { type: 'float32', data: Float32Array.of(RVM_DOWNSAMPLE_RATIO), dims: [1] } })
        if (!(result.pha?.data instanceof Uint16Array) || result.pha.data.length !== size.width * size.height) throw new Error('人像抠像遮罩尺寸不匹配')
        bytes = rvmMatte(result.pha.data)
      } else {
        const result = await runner.run({ pixel_values: { type: 'float32', data: selfieInput(rgb), dims: [1, 3, 256, 256] } })
        const values = Object.values(result)[0]?.data
        if (!(values instanceof Float32Array) || values.length !== 256 * 256) throw new Error('快速人像遮罩尺寸不匹配')
        bytes = selfieMatte(values, size.width, size.height)
      }
      inferenceMs += performance.now() - started; runners = [runner]; model = name
      return { bytes: await visible(bytes, size.width, size.height), ...size }
    }
    let result: Awaited<ReturnType<typeof runPortrait>>
    if (job.region.quality === 'fast') result = await runPortrait('selfie')
    else {
      try { result = await runPortrait('rvm') }
      catch (error) { deps.signal.throwIfAborted(); deps.log('warn', '人物抠像不可用，改用快速人像分割', 'image_edit.subject.portrait_fallback', { reason: String(error) }); result = await runPortrait('selfie') }
    }
    candidates = portraitCandidates(result.bytes, result.width, result.height)
  } else {
    runners = await Promise.all([open('etam_image_encoder', 'etam-512'), open('etam_mask_decoder', 'etam-512')])
    const session = new EfficientTamImageSession({ imageEncoder: runners[0], maskDecoder: runners[1] }), rgb = await resize(512, 512)
    let started = performance.now(); const features = await session.encode(rgb); inferenceMs += performance.now() - started
    const prompts = job.region.kind === 'point' ? [etamPromptFromNormalized({ points: job.region.points.map(p => [p.x, p.y, p.foreground ? 1 : 0] as const) })]
      : job.region.kind === 'box' ? [etamPromptFromNormalized({ box: [job.region.x, job.region.y, job.region.width, job.region.height] })]
        // 固定粗网格是首轮采样预算；候选不按数量截断，用户可在任意位置继续点选。
        : [0.25, 0.5, 0.75].flatMap(y => [0.25, 0.5, 0.75].map(x => etamPromptFromNormalized({ points: [[x, y, 1]] })))
    candidates = []
    for (let i = 0; i < prompts.length; i++) {
      deps.signal.throwIfAborted(); started = performance.now()
      const result = await session.promptImage(features, prompts[i]); inferenceMs += performance.now() - started
      if (result.score > 0) {
        const logits = job.region.kind === 'subject' && result.candidates ? result.candidates : [result.logits]
        for (let j = 0; j < logits.length; j++) {
          const mask = Uint8Array.from(etamUpsampleBinary(logits[j]), value => value * 255)
          const candidate = subjectCandidate(await visible(mask, 512, 512), 512, 512, result.candidateScores?.[j] ?? 1)
          if (candidate && (job.region.kind !== 'subject' || (candidate.area >= 0.01 && candidate.area <= 0.85))) candidates.push(candidate)
        }
      }
      deps.progress(i + 1, prompts.length)
    }
    candidates = distinctSubjectCandidates(candidates); model = 'efficienttam'
  }
  deps.signal.throwIfAborted()
  return { candidates, model: model!, providers: runners.map(runner => runner.provider), inferenceMs, durationMs: performance.now() - begun }
}
