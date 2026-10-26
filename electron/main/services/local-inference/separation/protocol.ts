import type { LocalExecutionProvider } from '../providers'

/*
 * 人声分离与去混响在本地推理后台进程里的作业：解码 → MDX-Net 分块推理 → 写两个 32 位浮点 WAV。
 * 主进程负责内容身份、模型准备与缓存；这里只做计算，输出写进主进程给的专用目录，由主进程改名进缓存。
 */

/** `vocals`：人声分离（主分量是人声，残差是伴奏）；`dereverb`：去混响（主分量是干声，残差是混响）。 */
export type AudioSeparationMode = 'vocals' | 'dereverb'

export interface AudioSeparationJob {
  id: string
  ffmpegPath: string
  /** 任意音频或带音轨的视频文件（取第一条音轨）。 */
  source: string
  mode: AudioSeparationMode
  modelPath: string
  providers: LocalExecutionProvider[]
  /** 本作业独占的目录：写入 `primary.wav.tmp` 与 `residual.wav.tmp`，失败或取消时删除。 */
  outputDirectory: string
}

export interface AudioSeparationJobResult {
  /** vocals 模式为人声；dereverb 模式为去混响后的干声。 */
  primaryPath: string
  /** 原声 − 主分量（伴奏 / 混响）；与主分量逐样本相加等于原声。 */
  residualPath: string
  /** 与输入相同的采样率与声道数（输出与输入等长、逐样本对齐）。 */
  sampleRate: number
  channels: number
  /** 实际执行推理的提供者（DirectML 结果异常时会回退到 CPU）。 */
  provider: LocalExecutionProvider
  decodeMs: number
  inferenceMs: number
}
