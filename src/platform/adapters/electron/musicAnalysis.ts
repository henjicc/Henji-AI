import type { MusicAnalysisPlatform } from '../../contracts/musicAnalysis'
function native(): MusicAnalysisPlatform {
  const api = window.henjiNative?.musicAnalysis as MusicAnalysisPlatform | undefined
  if (!api) throw new Error('音乐分析不可用，请重新启动应用。')
  return api
}
export function createElectronMusicAnalysis(): MusicAnalysisPlatform {
  return { analyze: request => native().analyze(request), cancel: id => native().cancel(id), onProgress: listener => native().onProgress(listener) }
}
