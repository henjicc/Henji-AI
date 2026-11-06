import type { ReactNode } from 'react'

/** 选框上边中点有旋转手柄（24 高），编辑条放在它上方。 */
const ROTATE_HANDLE_CLEARANCE = 32

/**
 * 选中画面上的对象时贴在选框旁的编辑条（选框上方，靠近画面顶边时放到下方）：只放最常用的几项，完整属性仍在效果控件。
 * 文字片段、字幕与代码元素共用这一个外壳，内容由各自的宿主给。`polygon` 是选框四角，画面比例 0–1。
 */
export function VideoEditPictureEditBar({ polygon, label, children }: { polygon: ReadonlyArray<{ x: number; y: number }>; label: string; children: ReactNode }): React.ReactElement {
  const xs = polygon.map(point => point.x), ys = polygon.map(point => point.y)
  const top = Math.min(...ys), bottom = Math.max(...ys)
  const center = Math.max(.08, Math.min(.92, (Math.min(...xs) + Math.max(...xs)) / 2))
  const above = top > .14
  return <div role="toolbar" aria-label={label} data-video-edit-picture-edit-bar
    className="ui-glass pointer-events-auto absolute flex items-center gap-0.5 rounded-control p-0.5"
    style={{ left: `${center * 100}%`, top: `${(above ? top : Math.min(bottom, .9)) * 100}%`, transform: above ? `translate(-50%, calc(-100% - ${ROTATE_HANDLE_CLEARANCE}px))` : 'translate(-50%, 8px)' }}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {children}
  </div>
}
