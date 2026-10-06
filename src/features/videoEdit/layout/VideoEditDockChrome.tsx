import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, LayoutGrid, Maximize2, Menu, Minimize2, RotateCcw, X } from 'lucide-react'
import type { DockviewApi, IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'
import { PanelTrigger, UiIconButton, UiOptionButton } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { toggleDockGroupMaximized } from '@/components/dockviewDocking'
import { showVideoEditPanel, VIDEO_EDIT_PANELS } from './videoEditDockLayout'
import { dockVideoEditPopout, isVideoEditPanelPoppedOut, isVideoEditPopoutPanel, popOutVideoEditGroup, popOutVideoEditPanel, resetVideoEditWorkspaceLayout, subscribeVideoEditPopouts, videoEditPopoutRevision } from './popout/videoEditPopouts'

export function VideoEditDockTab({ api }: IDockviewPanelHeaderProps): React.ReactElement {
  const [title, setTitle] = useState(api.title ?? '')
  useEffect(() => { const event = api.onDidTitleChange(value => setTitle(value.title)); return () => event.dispose() }, [api])
  // 文字色交给 dockview 的标签色变量（选中主要文字、其余辅助文字，见 index.css 面板标签映射）
  // 关闭按钮只在悬停标签或键盘聚焦时出现（设计稿面板头为纯文字标签），命中区始终保留，不改变标签宽度。
  return <span className="group/dock-tab flex h-full items-center gap-1.5 pl-2 pr-1 text-xs">
    <span>{title}</span>
    <UiIconButton size="xs" className="opacity-0 transition-opacity duration-120 focus-visible:opacity-100 group-hover/dock-tab:opacity-100" title={`关闭${title}`} aria-label={`关闭${title}`}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); api.close() }}><X size={12} /></UiIconButton>
  </span>
}

/**
 * 面板组菜单，叫法与 PR 一致（剪辑对齐 PR 1.1）。“浮动”即浮出为独立系统窗口（重要记录 001）；
 * 一个窗口放多个面板不在本期，浮动面板组时组内每个面板各开一个窗口。
 */
export function VideoEditDockHeaderActions({ api, containerApi, activePanel, panels, group }: IDockviewHeaderActionsProps): React.ReactElement {
  const [maximized, setMaximized] = useState(api.isMaximized())
  useEffect(() => {
    const event = containerApi.onDidMaximizedGroupChange(() => setMaximized(api.isMaximized()))
    return () => event.dispose()
  }, [api, containerApi])
  const canFloatPanel = Boolean(activePanel && isVideoEditPopoutPanel(activePanel.id))
  const canFloatGroup = panels.some(panel => isVideoEditPopoutPanel(panel.id))
  const toggleMaximized = (): void => { toggleDockGroupMaximized(containerApi, undefined, group) }
  const maximizeLabel = maximized ? '恢复面板组大小' : '最大化面板组'
  return <PanelTrigger panelWidth={196} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu"
    renderPanel={() => <div className="flex flex-col gap-1" role="menu" aria-label="面板菜单">
      <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={!activePanel} onClick={() => activePanel?.api.close()}>关闭面板</UiOptionButton>
      <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={!canFloatPanel} onClick={() => { if (activePanel && isVideoEditPopoutPanel(activePanel.id)) popOutVideoEditPanel(containerApi, activePanel.id) }}>浮动面板</UiOptionButton>
      <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={panels.length < 2 || !activePanel} onClick={() => panels.filter(panel => panel !== activePanel).forEach(panel => panel.api.close())}>关闭组中的其他面板</UiOptionButton>
      <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={!canFloatGroup} onClick={() => popOutVideoEditGroup(containerApi, group)}>浮动面板组</UiOptionButton>
      <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={api.location.type !== 'grid' || (!maximized && containerApi.groups.length < 2)} onClick={toggleMaximized}>{maximizeLabel}</UiOptionButton>
      <UiOptionButton role="menuitem" variant="menu" size="sm" onClick={() => api.close()}>关闭面板组</UiOptionButton>
      <UiOptionButton role="menuitem" variant="menu" size="sm" onClick={() => resetVideoEditWorkspaceLayout(containerApi)}>重置布局</UiOptionButton>
    </div>}>
    {({ open, togglePanel }) => <div className="flex h-full items-center gap-1 pr-1" data-video-edit-dock-actions data-open={open ? 'true' : undefined}>
      {api.location.type === 'grid' && <UiIconButton size="sm" title={maximizeLabel} aria-label={maximizeLabel} onClick={toggleMaximized}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</UiIconButton>}
      <UiIconButton size="sm" title="面板菜单" aria-label="面板菜单" aria-haspopup="menu" aria-expanded={open} on={open} data-panel-trigger-button onClick={togglePanel}><Menu size={14} /></UiIconButton>
    </div>}
  </PanelTrigger>
}

/** Lives in the workspace's existing command strip, so closed panels remain reachable. */
export function VideoEditLayoutMenu({ api }: { api: DockviewApi | null }): React.ReactElement {
  const [, refresh] = useState(0)
  useSyncExternalStore(subscribeVideoEditPopouts, videoEditPopoutRevision)
  useEffect(() => {
    if (!api) return
    const events = [api.onDidAddPanel(() => refresh(value => value + 1)), api.onDidRemovePanel(() => refresh(value => value + 1))]
    return () => events.forEach(event => event.dispose())
  }, [api])
  return <PanelTrigger panelWidth={164} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu"
    renderPanel={() => <div className="flex flex-col gap-1">
      {VIDEO_EDIT_PANELS.map(panel => <UiOptionButton key={panel.id} variant="menu" size="sm" className="flex items-center justify-between" onClick={() => {
        if (!api) return
        // 浮出的面板再点一次即贴回主窗口，不会在 Dock 中再建第二份。
        if (isVideoEditPanelPoppedOut(panel.id)) { dockVideoEditPopout(panel.id); return }
        const existing = api.getPanel(panel.id)
        if (existing) existing.api.close(); else showVideoEditPanel(api, panel.id)
      }}><span>{panel.title}</span>{(api?.getPanel(panel.id) || isVideoEditPanelPoppedOut(panel.id)) && <Check size={13} />}</UiOptionButton>)}
      <UiOptionButton variant="menu" size="sm" className="flex items-center gap-2" disabled={!api} onClick={() => { if (api) resetVideoEditWorkspaceLayout(api) }}><RotateCcw size={13} />重置布局</UiOptionButton>
    </div>}>
    {({ open, togglePanel }) => <UiIconButton disabled={!api} aria-label="面板" title="面板与布局" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><LayoutGrid size={16} /></UiIconButton>}
  </PanelTrigger>
}
