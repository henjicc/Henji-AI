import sharp from 'sharp'
import type { LocalModelRunner } from '../analysis'
import type { LocalInferenceModelFile } from '../protocol'
import type { LocalExecutionProvider } from '../providers'
import { ppocrInputSize } from '../analyzers/textDetection'
import { FrameOcr, withOcrImageBudget } from './frameOcr'
import type { RecognitionNormalization } from './recognition'

export interface ImageTextJob {
  id: string
  imagePath: string
  models: LocalInferenceModelFile[]
  providers: LocalExecutionProvider[]
  dictionaryPath: string
  normalization?: RecognitionNormalization
}

export interface ImageTextLine {
  text: string
  confidence: number
  /** 按图片宽高归一化的 [x, y, w, h]。 */
  box: [number, number, number, number]
}

export interface ImageTextResult { width: number; height: number; lines: ImageTextLine[] }

export interface ImageTextDependencies {
  alphabet: readonly string[]
  signal: AbortSignal
  openModel(model: LocalInferenceModelFile, providers: LocalExecutionProvider[], shape: string): Promise<LocalModelRunner>
}

/** 单张静态图片走与录屏隐私识别同一套检测加识别；只取第一帧，EXIF 方向先摆正。 */
export async function runImageText(job: ImageTextJob, deps: ImageTextDependencies): Promise<ImageTextResult> {
  deps.signal.throwIfAborted()
  const det = job.models.find(model => model.name === 'ppocr'), rec = job.models.find(model => model.name === 'ppocr_rec')
  if (!det || !rec) throw new Error('应用内置文字模型未准备好，请重新安装应用后重试。')
  const { data, info } = await sharp(job.imagePath, { animated: false }).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.channels !== 3) throw new Error('图片颜色通道无法转换为 RGB。')
  deps.signal.throwIfAborted()
  const size = ppocrInputSize(info.width, info.height)
  // 单张图片只跑一次，CPU 足够快，也避免显卡冷启动。
  const detector = await deps.openModel(det, ['cpu'], `${size.width}x${size.height}`)
  const recognizer = await deps.openModel(rec, ['cpu'], 'dynamic')
  const ocr = new FrameOcr(detector, recognizer, deps.alphabet, job.normalization)
  const result = await withOcrImageBudget(() => ocr.run(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, deps.signal))
  return { width: info.width, height: info.height, lines: result.lines.map(line => ({ text: line.text, confidence: line.confidence, box: line.box })) }
}
