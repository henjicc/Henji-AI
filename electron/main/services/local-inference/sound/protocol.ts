import type { SoundFeatures } from '../../../../../src/core/soundLibrary/soundFeatures'
import type { LocalExecutionProvider } from '../providers'

/*
 * 音效分析（音效库）在本地推理后台进程里的作业：解码、DSP 测量，听音模型就绪时再算 CLAP 音频向量；
 * 文本描述的向量单独一个作业。主进程负责扫描、缓存与排序，这里只做计算。
 */

export interface SoundClapModels {
  audioModelPath: string
  textModelPath: string
  tokenizerPath: string
  tokenizerConfigPath: string
}

export interface SoundAnalysisJob {
  id: string
  ffmpegPath: string
  files: Array<{ path: string }>
  /** 省略时只做 DSP 测量。 */
  clap?: SoundClapModels
  providers: LocalExecutionProvider[]
}

export type SoundAnalysisFileResult =
  | { path: string; ok: true; features: SoundFeatures; embedding?: number[] }
  | { path: string; ok: false; reason: string }

export interface SoundAnalysisResult {
  files: SoundAnalysisFileResult[]
  provider: LocalExecutionProvider | null
  decodeMs: number
  inferenceMs: number
}

export interface SoundTextEmbeddingJob {
  id: string
  clap: SoundClapModels
  texts: string[]
  providers: LocalExecutionProvider[]
}

export interface SoundTextEmbeddingResult {
  embeddings: number[][]
}
