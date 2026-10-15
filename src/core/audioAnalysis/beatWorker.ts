import { AudioContentAnalyzer, type AudioContentAnalysis } from './contentAnalysis'
import { BeatAnalyzer, type BeatAnalysisResult } from './beatAnalysis'
export type BeatWorkerRequest = { kind: 'begin'; sampleRate: number; fps?: number } | { kind: 'block'; planes: Float32Array[] } | { kind: 'finish' }
export type BeatWorkerResponse = { kind: 'received' } | { kind: 'result'; result: BeatAnalysisResult } | { kind: 'content'; result: AudioContentAnalysis } | { kind: 'error'; message: string }
const scope = self as unknown as DedicatedWorkerGlobalScope
let analyzer: BeatAnalyzer | AudioContentAnalyzer | undefined
scope.onmessage = (event: MessageEvent<BeatWorkerRequest>): void => {
  try {
    if (event.data.kind === 'begin') analyzer = event.data.fps === undefined ? new BeatAnalyzer(event.data.sampleRate) : new AudioContentAnalyzer(event.data.sampleRate, event.data.fps)
    else if (!analyzer) throw new Error('声音尚未就绪。')
    else if (event.data.kind === 'block') analyzer.append(event.data.planes)
    else { scope.postMessage(analyzer instanceof AudioContentAnalyzer ? { kind: 'content', result: analyzer.finish() } satisfies BeatWorkerResponse : { kind: 'result', result: analyzer.finish() } satisfies BeatWorkerResponse); analyzer = undefined; return }
    scope.postMessage({ kind: 'received' } satisfies BeatWorkerResponse)
  } catch (error) { scope.postMessage({ kind: 'error', message: error instanceof Error ? error.message : '节拍分析失败。' } satisfies BeatWorkerResponse) }
}
