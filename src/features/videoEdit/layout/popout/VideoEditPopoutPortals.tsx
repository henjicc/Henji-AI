import { useLayoutEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { listVideoEditPopouts, subscribeVideoEditPopouts, type VideoEditPopoutEntry, type VideoEditPopoutPanelId } from './videoEditPopouts'
import { VIDEO_EDIT_POPOUT_FOCUS_ATTRIBUTE } from './videoEditPopoutWindow'

/** 浮窗内容的焦点根：可聚焦（不进 Tab 序列），焦点掉到子窗 body 时由窗口宿主收回到这里。 */
function PopoutFrame({ entry, onFocusPanel, children }: { entry: VideoEditPopoutEntry; onFocusPanel: (id: VideoEditPopoutPanelId) => void; children: React.ReactNode }): React.ReactElement {
  const { popout } = entry
  useLayoutEffect(() => { popout.restoreFocus() }, [popout])
  return <div tabIndex={-1} {...{ [VIDEO_EDIT_POPOUT_FOCUS_ATTRIBUTE]: '' }} className="flex h-full min-h-0 flex-col outline-none"
    onPointerDownCapture={() => onFocusPanel(entry.id)} onFocusCapture={() => onFocusPanel(entry.id)}>
    {children}
  </div>
}

/**
 * 把浮出的面板渲染进系统浮窗。portal 仍挂在主窗口 React 树内：上下文、领域服务和
 * 合成事件冒泡（含剪辑工作区根部的快捷键处理）都与 Dock 内相同。
 * 浮窗元素属于子窗口的 realm，`instanceof HTMLElement` 对其不成立，这里用捕获阶段
 * 直接登记活动面板，不依赖跨 realm 的类型判断。
 */
export function VideoEditPopoutPortals({ render, onFocusPanel }: {
  render: (id: VideoEditPopoutPanelId, visible: boolean) => React.ReactNode
  onFocusPanel: (id: VideoEditPopoutPanelId) => void
}): React.ReactElement {
  const entries = useSyncExternalStore(subscribeVideoEditPopouts, listVideoEditPopouts)
  return <>{entries.filter(entry => entry.ready).map(entry => createPortal(
    <PopoutFrame entry={entry} onFocusPanel={onFocusPanel}>{render(entry.id, entry.visible)}</PopoutFrame>,
    entry.popout.container,
    entry.id,
  ))}</>
}
