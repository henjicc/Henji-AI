/**
 * 时间线视口的命令入口：缩放到整个序列（`\`）、翻屏（Page Up／Page Down）与缩放工具要读写正在显示的时间线滚动位置，
 * 由挂载中的时间线登记、按剪辑查找；命令层不直接碰 DOM。时间线没有显示时这些命令不可用。
 */
export interface VideoEditTimelineViewportControl {
  readonly sequenceId: string
  zoomToSequence(): void
  showScreen(direction: -1 | 1): void
  /** 缩放工具单击：以 `frame` 为中心按倍数缩放（该帧留在光标所在位置）。 */
  zoomAt(frame: number, factor: number): void
  /** 缩放工具框选与缩放滚动条：让 `[from, to)` 帧正好铺满可见宽度。 */
  showRange(from: number, to: number): void
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
