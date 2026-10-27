import { useEffect, useSyncExternalStore } from 'react'
import { subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { peekVideoEditRenderCache, requestVideoEditRenderBarWindows, subscribeVideoEditRenderBar, videoEditRenderBarRevision, type VideoEditRenderWindowState } from '../application/videoEditRenderCache'

const STATE_CLASS: Record<Exclude<VideoEditRenderWindowState, 'realtime'>, string> = { ready: 'bg-success-solid', rendering: 'bg-accent', dropped: 'bg-danger-solid', predicted: 'bg-warning-solid' }

/**
 * 标尺顶部的渲染条（PR）：已渲染绿、正在渲染强调色、实测掉帧红、预计吃力黄，能实时播放的段落不画。
 * 编辑后先画上一次的结果，绘制后空闲时再分段（大工程分段要几十毫秒），按键到片段消失不等它。
 */
export function VideoEditRenderBar({ instance, pixels }: { instance: VideoEditInstance; pixels: number }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  useSyncExternalStore(subscribeVideoEditRenderBar, videoEditRenderBarRevision)
  const projectId = instance.document.id
  let read: ReturnType<typeof peekVideoEditRenderCache> | undefined
  try { read = peekVideoEditRenderCache(projectId) } catch { read = undefined }
  const stale = read?.current === false
  useEffect(() => { if (stale) requestVideoEditRenderBarWindows(projectId) })
  const view = read?.view
  if (!view) return null
  return <div aria-hidden="true" data-video-edit-render-bar className="pointer-events-none absolute left-0 right-0 top-0 h-1">
    {view.windows.map(window => window.state === 'realtime' ? null : <div key={window.startFrame} data-video-edit-render-window={window.state} data-start-frame={window.startFrame} data-end-frame={window.endFrame}
      className={`absolute top-0 h-full ${STATE_CLASS[window.state]}`} style={{ left: window.startFrame * pixels, width: Math.max(1, (window.endFrame - window.startFrame) * pixels) }} />)}
  </div>
}
