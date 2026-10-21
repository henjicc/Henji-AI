import type { MusicAnalysis } from '../../../../../src/core/audioAnalysis/music/musicAnalysis'
import type { LocalExecutionProvider } from '../providers'

/*
 * 音乐结构分析（音频重构）在本地推理后台进程里的作业：解码整首曲子，节拍模型就绪时跑 Beat This!，
 * 否则用谱通量回退；再算每拍特征、段落与适用性。主进程负责授权、内容身份与缓存，这里只做计算。
 */

export interface MusicBeatModel {
  modelPath: string
  filterbankPath: string
}

export interface MusicAnalysisJob {
  id: string
  ffmpegPath: string
  source: string
  /** 省略时用谱通量回退（节拍模型未下载或下载失败）。 */
  model?: MusicBeatModel
  providers: LocalExecutionProvider[]
}

export interface MusicAnalysisJobResult {
  analysis: MusicAnalysis
  provider: LocalExecutionProvider | null
  decodeMs: number
  inferenceMs: number
  featureMs: number
}
