import { useEffect, useSyncExternalStore } from 'react'
import { videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { peekVideoEditRenderCache, requestVideoEditRenderBarWindows, subscribeVideoEditRenderBar, videoEditRenderBarRevision, type VideoEditRenderWindowState } from '../application/videoEditRenderCache'
import { useVideoEditViewSelector } from '../application/useVideoEditViewSelector'

const STATE_CLASS: Record<Exclude<VideoEditRenderWindowState, 'realtime'>, string> = { ready: 'bg-success-solid', rendering: 'bg-accent', dropped: 'bg-danger-solid', predicted: 'bg-warning-solid' }
interface RenderBarRead { revision: number; read?: ReturnType<typeof peekVideoEditRenderCache> }
/**
 * 播放中实测掉帧不另发通知，所以每次视图通知都重读渲染条，只在每段起止或状态变化时重绘。
 * 内容发布也要重绘：读数过期时每次编辑都要在绘制后重新请求空闲分段。
 */
function sameRenderBarRead(previous: RenderBarRead, next: RenderBarRead): boolean {
  if (previous.revision !== next.revision || previous.read?.current !== next.read?.current) return false
  const a = previous.read?.view?.windows; const b = next.read?.view?.windows
  if (!a || !b) return a === b
  return a.length === b.length && a.every((window, index) => window.startFrame === b[index].startFrame && window.endFrame === b[index].endFrame && window.state === b[index].state)
}

/**
 * 标尺顶部的渲染条（PR）：已渲染绿、正在渲染强调色、实测掉帧红、预计吃力黄，能实时播放的段落不画。
 * 编辑后先画上一次的结果，绘制后空闲时再分段（大工程分段要几十毫秒），按键到片段消失不等它。
 */
export function VideoEditRenderBar({ instance, pixels }: { instance: VideoEditInstance; pixels: number }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditRenderBar, videoEditRenderBarRevision)
  const projectId = instance.document.id
  const { read } = useVideoEditViewSelector((): RenderBarRead => {
    try { return { revision: videoEditRevision(), read: peekVideoEditRenderCache(projectId) } } catch { return { revision: videoEditRevision() } }
  }, sameRenderBarRead)
  const stale = read?.current === false
  useEffect(() => { if (stale) requestVideoEditRenderBarWindows(projectId) })
  const view = read?.view
  if (!view) return null
  return <div aria-hidden="true" data-video-edit-render-bar className="pointer-events-none absolute left-0 right-0 top-0 h-1">
    {view.windows.map(window => window.state === 'realtime' ? null : <div key={window.startFrame} data-video-edit-render-window={window.state} data-start-frame={window.startFrame} data-end-frame={window.endFrame}
      className={`absolute top-0 h-full ${STATE_CLASS[window.state]}`} style={{ left: window.startFrame * pixels, width: Math.max(1, (window.endFrame - window.startFrame) * pixels) }} />)}
  </div>
}
