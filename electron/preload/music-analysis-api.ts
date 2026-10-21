import { MUSIC_ANALYSIS_CHANNELS, type MusicAnalysisPlatform, type MusicAnalysisProgress } from '../../src/platform/contracts/musicAnalysis'
export function createMusicAnalysisApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>, subscribe: (channel: string, handler: (payload: unknown) => void) => () => void): MusicAnalysisPlatform {
  return { analyze: request => invoke(MUSIC_ANALYSIS_CHANNELS.analyze, request), cancel: id => invoke(MUSIC_ANALYSIS_CHANNELS.cancel, id), onProgress: handler => subscribe(MUSIC_ANALYSIS_CHANNELS.progress, value => handler(value as MusicAnalysisProgress)) }
}
