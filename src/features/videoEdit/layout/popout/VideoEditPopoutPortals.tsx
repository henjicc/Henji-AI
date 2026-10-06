import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { SquareArrowDownLeft, X } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiChipButton, UiIconButton, UiWindowControl } from '@/components/ui'
import { WindowTitleBar } from '@/components/WindowTitleBar'
import { useContextMenu } from '@/hooks/useContextMenu'
import { VIDEO_EDIT_PANELS } from '../videoEditDockLayout'
import { activateVideoEditPopoutPanel, closeVideoEditPopout, closeVideoEditPopoutWindow, dockVideoEditPopout, dockVideoEditPopoutWindow, listVideoEditPopouts, rememberVideoEditPopoutBounds, subscribeVideoEditPopouts, videoEditPopoutDropTarget, type VideoEditPopoutEntry, type VideoEditPopoutPanelId } from './videoEditPopouts'
import { startVideoEditPopoutDrag, startVideoEditPopoutTabDrag } from './videoEditPopoutDrag'
import { VIDEO_EDIT_POPOUT_FOCUS_ATTRIBUTE } from './videoEditPopoutWindow'

const MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
const titleOf = (id: VideoEditPopoutPanelId): string => VIDEO_EDIT_PANELS.find(panel => panel.id === id)?.title ?? id

/**
 * 独立窗口的自定义标题栏（窗口无系统边框）：左侧是窗口里的面板标签（PR 一个浮动窗口可容纳多个面板），右侧贴回与关闭整个窗口。
 * 拖标题栏空白处移动窗口并可拖回主窗口停靠或叠进另一个浮窗；多个标签时拖一个标签只带走这个面板；
 * 单击标签切换当前面板，右键标签可单独贴回或关闭；双击标题栏最大化／还原（见 videoEditPopoutDrag.ts）。
 * 四边与四角缩放由系统无边框窗口的缩放边框提供。
 */
function PopoutTitleBar({ entry, onCollapsedChange }: { entry: VideoEditPopoutEntry; onCollapsedChange: (collapsed: boolean) => void }): React.ReactElement {
  const menu = useContextMenu()
  const multiple = entry.panels.length > 1
  const label = multiple ? '面板组' : titleOf(entry.active)
  return <WindowTitleBar size="panel" dragRegion="custom"
    onPointerDown={event => {
      if (event.button !== 0) return
      const tab = (event.target as Element).closest?.('[data-video-edit-popout-tab]')?.getAttribute('data-video-edit-popout-tab') as VideoEditPopoutPanelId | null | undefined
      // PR：按下标签即切到它；按住拖动只带走这个面板（指针被标题栏捕获，单击事件不会落在标签上）。
      if (tab && multiple) { activateVideoEditPopoutPanel(entry.key, tab); startVideoEditPopoutTabDrag(entry.key, tab, entry.popout, event.currentTarget, event.nativeEvent); return }
      startVideoEditPopoutDrag(entry.key, entry.popout, event.currentTarget, event.nativeEvent, { onCollapsedChange, onMoved: rememberVideoEditPopoutBounds })
    }}
    onDoubleClick={() => entry.popout.toggleMaximized()}
    actions={<>
      <UiIconButton size="sm" title={multiple ? '全部贴回主窗口' : '贴回主窗口'} aria-label="贴回主窗口" onClick={() => dockVideoEditPopoutWindow(entry.key)}><SquareArrowDownLeft size={14} /></UiIconButton>
      <UiWindowControl platform={MAC ? 'mac' : 'windows'} action="close" title={`关闭${label}`} aria-label={`关闭${label}`} onClick={() => closeVideoEditPopoutWindow(entry.key)} />
    </>}>
    <div className="flex h-full min-w-0 items-center gap-0.5 overflow-hidden" role="tablist" aria-label="浮动窗口中的面板">
      {entry.panels.map(id => <UiChipButton key={id} size="sm" className="h-full" role="tab" aria-selected={id === entry.active} selectionRole="navigation" selectionAppearance="subtle" active={id === entry.active} tabIndex={-1}
        data-video-edit-popout-tab={id} title={multiple ? '单击切换；拖出可单独浮动或拖回主窗口；右键贴回或关闭' : undefined}
        onClick={() => activateVideoEditPopoutPanel(entry.key, id)}
        onContextMenu={event => {
          if (!multiple) return
          event.preventDefault()
          menu.showMenu(event, [
            { id: 'dock', label: '贴回主窗口', icon: <SquareArrowDownLeft size={16} />, onClick: () => dockVideoEditPopout(id) },
            { id: 'close', label: '关闭面板', icon: <X size={16} />, onClick: () => closeVideoEditPopout(id) },
          ])
        }}>{titleOf(id)}</UiChipButton>)}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
  </WindowTitleBar>
}

/** 浮窗内容的焦点根：可聚焦（不进 Tab 序列），焦点掉到子窗 body 时由窗口宿主收回到这里。 */
function PopoutFrame({ entry, dropTarget, onFocusPanel, children }: { entry: VideoEditPopoutEntry; dropTarget: boolean; onFocusPanel: (id: VideoEditPopoutPanelId) => void; children: React.ReactNode }): React.ReactElement {
  const { popout } = entry
  const [collapsed, setCollapsed] = useState(false)
  useLayoutEffect(() => { popout.restoreFocus() }, [popout])
  return <div tabIndex={-1} {...{ [VIDEO_EDIT_POPOUT_FOCUS_ATTRIBUTE]: '' }} className="relative flex h-full min-h-0 flex-col outline-none"
    onPointerDownCapture={() => onFocusPanel(entry.active)} onFocusCapture={() => onFocusPanel(entry.active)}>
    <PopoutTitleBar entry={entry} onCollapsedChange={setCollapsed} />
    {/* 拖向主窗口停靠时窗口收成标题条，内容不必排版。 */}
    <div className={`min-h-0 flex-1 flex-col ${collapsed ? 'hidden' : 'flex'}`}>{children}</div>
    {/* 别处的面板正拖到这个窗口上：松开就叠成这里的标签（PR 编组区）。 */}
    {dropTarget && <div aria-hidden="true" data-video-edit-popout-drop-target className="pointer-events-none absolute inset-0 z-drag border-2 border-accent-ring bg-accent-tint" />}
  </div>
}

/**
 * 把浮出的面板渲染进系统浮窗。portal 仍挂在主窗口 React 树内：上下文、领域服务和
 * 合成事件冒泡（含剪辑工作区根部的快捷键处理）都与 Dock 内相同。一个浮窗里的多个面板都保持挂载，
 * 只显示当前标签（与 Dock 的 always 渲染一致，切换标签不重建节目画面）。
 * 浮窗元素属于子窗口的 realm，`instanceof HTMLElement` 对其不成立，这里用捕获阶段
 * 直接登记活动面板，不依赖跨 realm 的类型判断。
 */
export function VideoEditPopoutPortals({ render, onFocusPanel }: {
  render: (id: VideoEditPopoutPanelId, visible: boolean) => React.ReactNode
  onFocusPanel: (id: VideoEditPopoutPanelId) => void
}): React.ReactElement {
  const entries = useSyncExternalStore(subscribeVideoEditPopouts, listVideoEditPopouts)
  const dropTarget = videoEditPopoutDropTarget()
  return <>{entries.map(entry => createPortal(
    <PopoutFrame entry={entry} dropTarget={dropTarget === entry.key} onFocusPanel={onFocusPanel}>
      {entry.panels.filter(id => !entry.pending.includes(id)).map(id => <div key={id} className={`min-h-0 flex-1 flex-col ${id === entry.active ? 'flex' : 'hidden'}`}>{render(id, entry.visible && id === entry.active)}</div>)}
    </PopoutFrame>,
    entry.popout.container,
    entry.key,
  ))}</>
}
