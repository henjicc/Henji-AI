/**
 * 时间线视口的命令入口：缩放到整个序列（`\`）与翻屏（Page Up／Page Down）要读写正在显示的时间线滚动位置，
 * 由挂载中的时间线登记、按剪辑查找；命令层不直接碰 DOM。时间线没有显示时这些命令不可用。
 */
export interface VideoEditTimelineViewportControl {
  readonly sequenceId: string
  zoomToSequence(): void
  showScreen(direction: -1 | 1): void
}
const controls = new Map<string, VideoEditTimelineViewportControl>()
export function registerVideoEditTimelineViewport(projectId: string, control: VideoEditTimelineViewportControl): () => void {
  controls.set(projectId, control)
  return () => { if (controls.get(projectId) === control) controls.delete(projectId) }
}
export function videoEditTimelineViewport(projectId: string, sequenceId: string): VideoEditTimelineViewportControl | undefined {
  const control = controls.get(projectId)
  return control?.sequenceId === sequenceId ? control : undefined
}
