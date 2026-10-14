import sharp from 'sharp'
import type { PrivacyBox } from '../../../../../src/core/screenRecording/privacy'
import type { LocalModelRunner } from '../analysis'
import { ppocrInput, ppocrInputSize, textBoxesFromMap, TEXT_DETECTION_PRESETS } from '../analyzers/textDetection'
import { cropHash, intersects } from './frameChanges'
import { recognitionCrop, recognizeCrops, type CropRecognizer, type RecognizedText, type RecognitionNormalization } from './recognition'

export interface OcrLine extends RecognizedText { box: PrivacyBox }
export interface FrameOcrResult { lines: OcrLine[]; detectionMs: number; recognitionMs: number; recognizedLines: number; reusedLines: number }

/** Only the serialized inference host may own this process-global Sharp setting; restore before its next job. */
export async function withOcrImageBudget<T>(run: () => Promise<T>): Promise<T> {
  const previous = sharp.concurrency()
  sharp.concurrency(Math.min(previous, 2))
  try { return await run() }
  finally { sharp.concurrency(previous) }
}
/** All OCR consumers use the same detector and batch recognizer. State never survives a job. */
export class FrameOcr {
  private readonly cache = new Map<string, RecognizedText>()
  private previous: OcrLine[] = []
  constructor(private readonly detector: LocalModelRunner, private readonly recognizer: LocalModelRunner | CropRecognizer, private readonly alphabet: readonly string[], private readonly normalization: RecognitionNormalization = 'rgb-half') {}
  async run(rgb: Uint8Array, width: number, height: number, signal: AbortSignal, changes: readonly PrivacyBox[] = [[0, 0, 1, 1]]): Promise<FrameOcrResult> {
    signal.throwIfAborted()
    const started = performance.now(), size = ppocrInputSize(width, height)
    const resized = await sharp(rgb, { raw: { width, height, channels: 3 } }).resize(size.width, size.height, { fit: 'fill', kernel: 'linear' }).raw().toBuffer()
    const output = Object.values(await this.detector.run({ x: { type: 'float32', data: ppocrInput(resized, size.width, size.height), dims: [1, 3, size.height, size.width] } }))[0]
    if (!output || !(output.data instanceof Float32Array) || output.data.length !== size.width * size.height) throw new Error('文字检测输出大小不符。')
    signal.throwIfAborted()
    const boxes = textBoxesFromMap(output.data, size.width, size.height, TEXT_DETECTION_PRESETS.screen).map(b => b.slice(0, 4) as PrivacyBox)
    // Preserve exact geometry outside changed tiles. Detector jitter must not cause another rec run.
    const changed = boxes.filter(box => changes.some(c => intersects(c, box)))
    // Appending text can change only tiles beyond an old box. The new, wider box replaces that old line.
    const unchanged = this.previous.filter(line => !changes.some(c => intersects(c, line.box)) && !changed.some(box => intersects(box, line.box)))
    const detectionMs = performance.now() - started, recStarted = performance.now()
    const crops = changed.map(box => recognitionCrop(width, height, box)), hashes = crops.map(crop => cropHash(rgb, width, crop))
    const results = hashes.map(hash => this.cache.get(hash)), missing = results.flatMap((v, i) => v ? [] : [i])
    const fresh = await (typeof this.recognizer === 'function' ? this.recognizer(rgb, width, missing.map(i => crops[i]), signal) : recognizeCrops(rgb, width, missing.map(i => crops[i]), this.recognizer, this.alphabet, signal, this.normalization))
    missing.forEach((i, n) => { results[i] = fresh[n]; this.cache.delete(hashes[i]); this.cache.set(hashes[i], fresh[n]) })
    while (this.cache.size > 1024) this.cache.delete(this.cache.keys().next().value!)
    const lines = [...unchanged, ...changed.map((box, i) => ({ box, ...results[i]! }))]
      .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
    this.previous = lines
    return { lines, detectionMs, recognitionMs: performance.now() - recStarted, recognizedLines: missing.length, reusedLines: unchanged.length + changed.length - missing.length }
  }
}
