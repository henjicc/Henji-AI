export interface AudioEditScrubControls {
  start: (frame: number) => void
  move: (frame: number) => void
  end: () => void
  step: (frame: number) => void
}

// 只连接当前预览实例与编辑器的瞬时手势，不新增业务状态或另一份播放引擎。
const controls = new Map<string, AudioEditScrubControls>()
export function bindAudioEditScrub(projectId: string, value: AudioEditScrubControls): () => void {
  controls.set(projectId, value)
  return () => { if (controls.get(projectId) === value) controls.delete(projectId) }
}
export function audioEditScrub(projectId: string): AudioEditScrubControls | undefined { return controls.get(projectId) }
