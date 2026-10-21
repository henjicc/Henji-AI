import type { MusicAnalysis } from '../../core/audioAnalysis/music/musicAnalysis'

/*
 * 音乐结构分析（音频重构用）：主进程按素材内容身份缓存，后台推理进程跑节拍模型 Beat This!（首次自动下载），
 * 下载失败时用谱通量回退。实现在 `electron/main/services/music-analysis/`，渲染层经 `src/commands/musicAnalysis.ts` 调用。
 */

export const MUSIC_ANALYSIS_CHANNELS = { analyze: 'music:analyze', cancel: 'music:analyze-cancel', progress: 'music:analyze-progress' } as const

export interface MusicAnalysisRequest {
  requestId: string
  /** 素材本机绝对路径（须在已授权的媒体目录内）。 */
  source: string
}

export interface MusicAnalysisResponse {
  analysis: MusicAnalysis
  /** `music-v<分析版本>:<节拍来源>:<内容身份>`，写进重构片段，内容或分析方法变化即不同。 */
  analysisIdentity: string
  cached: boolean
  /** 节拍模型：used 已使用；fallback 模型不可用（未下载成功），改用谱通量回退。 */
  model: 'used' | 'fallback'
  timings: { decodeMs: number; inferenceMs: number; featureMs: number; totalMs: number } | null
}

/** model：下载节拍模型；analyze：解码与推理。progress 为本阶段 0–1。 */
export interface MusicAnalysisProgress { requestId: string; phase: 'model' | 'analyze'; progress: number }

export interface MusicAnalysisPlatform {
  analyze(request: MusicAnalysisRequest): Promise<MusicAnalysisResponse>
  cancel(requestId: string): Promise<void>
  onProgress(listener: (event: MusicAnalysisProgress) => void): () => void
}
