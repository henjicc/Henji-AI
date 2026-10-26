/*
 * 音频编辑的“多轨”入口（参照 Audition 的“波形 | 多轨”）：多轨就是剪辑的序列（同一套时间线、混音、轨道效果与导出），
 * 由剪辑在启动时登记打开方式（避免音频编辑反向静态依赖剪辑）。单文件作品放进多轨后是动态链接：这里保存，多轨里的片段
 * 在后台重新渲染后自动换成新声音，渲染完成前继续用上一版。
 */
export type AudioEditMultitrackOpener = (audioDocumentId: string) => Promise<void>
let opener: AudioEditMultitrackOpener | null = null

export function registerAudioEditMultitrackOpener(next: AudioEditMultitrackOpener): () => void {
  opener = next
  return () => { if (opener === next) opener = null }
}
export function audioEditMultitrackAvailable(): boolean { return opener !== null }
export async function openAudioEditMultitrack(audioDocumentId: string): Promise<void> {
  if (!opener) throw new Error('多轨还没有准备好，请稍后再试。')
  await opener(audioDocumentId)
}
