import { useSyncExternalStore } from 'react'
import { subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { readVideoEditRenderCache, type VideoEditRenderWindowState } from '../application/videoEditRenderCache'

const STATE_CLASS: Record<Exclude<VideoEditRenderWindowState, 'realtime'>, string> = { ready: 'bg-success-solid', rendering: 'bg-accent', dropped: 'bg-danger-solid', predicted: 'bg-warning-solid' }

/** 标尺顶部的渲染条（PR）：已渲染绿、正在渲染强调色、实测掉帧红、预计吃力黄，能实时播放的段落不画。 */
export function VideoEditRenderBar({ instance, pixels }: { instance: VideoEditInstance; pixels: number }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  let view: ReturnType<typeof readVideoEditRenderCache>
  try { view = readVideoEditRenderCache(instance.document.id) } catch { return null }
  return <div aria-hidden="true" data-video-edit-render-bar className="pointer-events-none absolute left-0 right-0 top-0 h-1">
    {view.windows.map(window => window.state === 'realtime' ? null : <div key={window.startFrame} data-video-edit-render-window={window.state} data-start-frame={window.startFrame} data-end-frame={window.endFrame}
      className={`absolute top-0 h-full ${STATE_CLASS[window.state]}`} style={{ left: window.startFrame * pixels, width: Math.max(1, (window.endFrame - window.startFrame) * pixels) }} />)}
  </div>
}
