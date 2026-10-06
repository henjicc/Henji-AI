import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { SquareArrowDownLeft } from 'lucide-react'
import { UiChipButton, UiIconButton, UiWindowControl } from '@/components/ui'
import { WindowTitleBar } from '@/components/WindowTitleBar'
import { VIDEO_EDIT_PANELS } from '../videoEditDockLayout'
import { closeVideoEditPopout, dockVideoEditPopout, listVideoEditPopouts, rememberVideoEditPopoutBounds, subscribeVideoEditPopouts, type VideoEditPopoutEntry, type VideoEditPopoutPanelId } from './videoEditPopouts'
import { startVideoEditPopoutDrag } from './videoEditPopoutDrag'
import { VIDEO_EDIT_POPOUT_FOCUS_ATTRIBUTE } from './videoEditPopoutWindow'

const MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

/**
 * 独立窗口的自定义标题栏（窗口无系统边框）：左侧面板标签，右侧贴回与关闭；拖动移动窗口并可拖回主窗口停靠，
 * 双击最大化／还原（见 videoEditPopoutDrag.ts）。四边与四角缩放由系统无边框窗口的缩放边框提供。
 */
function PopoutTitleBar({ entry, onCollapsedChange }: { entry: VideoEditPopoutEntry; onCollapsedChange: (collapsed: boolean) => void }): React.ReactElement {
  const title = VIDEO_EDIT_PANELS.find(panel => panel.id === entry.id)?.title ?? entry.id
  return <WindowTitleBar size="panel" dragRegion="custom"
    onPointerDown={event => {
      if (event.button !== 0) return
      startVideoEditPopoutDrag(entry.id, entry.popout, event.currentTarget, event.nativeEvent, { onCollapsedChange, onMoved: rememberVideoEditPopoutBounds })
    }}
    onDoubleClick={() => entry.popout.toggleMaximized()}
    actions={<>
      <UiIconButton size="sm" title="贴回主窗口" aria-label="贴回主窗口" onClick={() => dockVideoEditPopout(entry.id)}><SquareArrowDownLeft size={14} /></UiIconButton>
      <UiWindowControl platform={MAC ? 'mac' : 'windows'} action="close" title={`关闭${title}`} aria-label={`关闭${title}`} onClick={() => closeVideoEditPopout(entry.id)} />
    </>}>
    <UiChipButton size="sm" className="h-full" selectionRole="navigation" selectionAppearance="subtle" active tabIndex={-1}>{title}</UiChipButton>
  </WindowTitleBar>
}

/** 浮窗内容的焦点根：可聚焦（不进 Tab 序列），焦点掉到子窗 body 时由窗口宿主收回到这里。 */
function PopoutFrame({ entry, onFocusPanel, children }: { entry: VideoEditPopoutEntry; onFocusPanel: (id: VideoEditPopoutPanelId) => void; children: React.ReactNode }): React.ReactElement {
  const { popout } = entry
  const [collapsed, setCollapsed] = useState(false)
  useLayoutEffect(() => { popout.restoreFocus() }, [popout])
  return <div tabIndex={-1} {...{ [VIDEO_EDIT_POPOUT_FOCUS_ATTRIBUTE]: '' }} className="flex h-full min-h-0 flex-col outline-none"
    onPointerDownCapture={() => onFocusPanel(entry.id)} onFocusCapture={() => onFocusPanel(entry.id)}>
    <PopoutTitleBar entry={entry} onCollapsedChange={setCollapsed} />
    {/* 拖向主窗口停靠时窗口收成标题条，内容不必排版。 */}
    <div className={`min-h-0 flex-1 flex-col ${collapsed ? 'hidden' : 'flex'}`}>{children}</div>
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
