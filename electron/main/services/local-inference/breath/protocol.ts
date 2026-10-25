import type { BreathDetection } from '../../../../../src/core/audioAnalysis/breath/respiro'
import type { LocalExecutionProvider } from '../providers'

/*
 * 呼吸声检测在本地推理后台进程里的作业：解码成 16 kHz 单声道，按 30 秒一窗跑 Respiro，合并成呼吸区间。
 * 主进程负责内容身份、模型准备与缓存，这里只做计算。
 */

export interface BreathDetectionJob {
  id: string
  ffmpegPath: string
  source: string
  modelPath: string
  providers: LocalExecutionProvider[]
}

export interface BreathDetectionJobResult {
  detection: BreathDetection
  provider: LocalExecutionProvider
  decodeMs: number
  inferenceMs: number
}
