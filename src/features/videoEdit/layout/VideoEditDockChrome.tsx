import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, LayoutGrid, Maximize2, Menu, Minimize2, RotateCcw, X } from 'lucide-react'
import type { DockviewApi, IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'
import { PanelTrigger, UiButton, UiIconButton, UiOptionButton } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { dockVideoEditGroup, dockVideoEditPanel, showVideoEditPanel, VIDEO_EDIT_PANELS } from './videoEditDockLayout'
import { dockVideoEditPopout, isVideoEditPanelPoppedOut, isVideoEditPopoutPanel, popOutVideoEditPanel, resetVideoEditWorkspaceLayout, subscribeVideoEditPopouts, videoEditPopoutRevision } from './popout/videoEditPopouts'

export function VideoEditDockTab({ api }: IDockviewPanelHeaderProps): React.ReactElement {
  const [title, setTitle] = useState(api.title ?? '')
  useEffect(() => { const event = api.onDidTitleChange(value => setTitle(value.title)); return () => event.dispose() }, [api])
  return <span className="flex h-full items-center gap-2 pl-2 pr-1 text-xs text-text-dark">
    <span>{title}</span>
    <UiIconButton title={`关闭${title}`} aria-label={`关闭${title}`} showBorder={false} appearance="hover-only" className="h-5 w-5"
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); api.close() }}><X size={12} /></UiIconButton>
  </span>
}

export function VideoEditDockHeaderActions({ api, containerApi, activePanel, panels, group }: IDockviewHeaderActionsProps): React.ReactElement {
  const [maximized, setMaximized] = useState(api.isMaximized())
  const [floating, setFloating] = useState(api.location.type === 'floating')
  useEffect(() => {
    const events = [containerApi.onDidMaximizedGroupChange(() => setMaximized(api.isMaximized())), api.onDidLocationChange(value => setFloating(value.location.type === 'floating'))]
    return () => events.forEach(event => event.dispose())
  }, [api, containerApi])
  const popoutId = activePanel && isVideoEditPopoutPanel(activePanel.id) ? activePanel.id : null
  return <PanelTrigger panelWidth={180} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelClassName="p-1"
    renderPanel={() => <div className="flex flex-col gap-1">
      <UiOptionButton variant="menu" className="text-xs" disabled={!activePanel} onClick={() => activePanel?.api.close()}>关闭面板</UiOptionButton>
      <UiOptionButton variant="menu" className="text-xs" disabled={panels.length < 2 || !activePanel} onClick={() => panels.filter(panel => panel !== activePanel).forEach(panel => panel.api.close())}>关闭其他标签</UiOptionButton>
      <UiOptionButton variant="menu" className="text-xs" onClick={() => api.close()}>关闭整组</UiOptionButton>
      <UiOptionButton variant="menu" className="text-xs" disabled={!activePanel} onClick={() => { if (activePanel) { if (floating) dockVideoEditPanel(containerApi, activePanel); else containerApi.addFloatingGroup(activePanel) } }}>{floating ? '贴回面板' : '浮动面板'}</UiOptionButton>
      <UiOptionButton variant="menu" className="text-xs" onClick={() => { if (floating) dockVideoEditGroup(containerApi, group); else containerApi.addFloatingGroup(group) }}>{floating ? '贴回整组' : '浮动整组'}</UiOptionButton>
      {popoutId && <UiOptionButton variant="menu" className="text-xs" onClick={() => popOutVideoEditPanel(containerApi, popoutId)}>在独立窗口打开</UiOptionButton>}
      <UiOptionButton variant="menu" className="text-xs" disabled={api.location.type !== 'grid'} onClick={() => { if (maximized) api.exitMaximized(); else api.maximize() }}>{maximized ? '还原面板' : '放大面板'}</UiOptionButton>
      <UiOptionButton variant="menu" className="text-xs" onClick={() => resetVideoEditWorkspaceLayout(containerApi)}>重置布局</UiOptionButton>
    </div>}>
    {({ open, togglePanel }) => <div className="flex h-full items-center gap-1 pr-1">
      {api.location.type === 'grid' && <UiIconButton title={maximized ? '还原面板' : '放大面板'} aria-label={maximized ? '还原面板' : '放大面板'} showBorder={false} appearance="hover-only" className="h-6 w-6" onClick={() => { if (maximized) api.exitMaximized(); else api.maximize() }}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</UiIconButton>}
      <UiIconButton title="面板菜单" aria-label="面板菜单" showBorder={false} appearance="hover-only" active={open} className="h-6 w-6" data-panel-trigger-button onClick={togglePanel}><Menu size={14} /></UiIconButton>
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
  return <PanelTrigger panelWidth={164} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelClassName="p-1"
    renderPanel={() => <div className="flex flex-col gap-1">
      {VIDEO_EDIT_PANELS.map(panel => <UiOptionButton key={panel.id} variant="menu" className="flex items-center justify-between text-xs" onClick={() => {
        if (!api) return
        // 浮出的面板再点一次即贴回主窗口，不会在 Dock 中再建第二份。
        if (isVideoEditPanelPoppedOut(panel.id)) { dockVideoEditPopout(panel.id); return }
        const existing = api.getPanel(panel.id)
        if (existing) existing.api.close(); else showVideoEditPanel(api, panel.id)
      }}><span>{panel.title}</span>{(api?.getPanel(panel.id) || isVideoEditPanelPoppedOut(panel.id)) && <Check size={13} />}</UiOptionButton>)}
      <UiOptionButton variant="menu" className="flex items-center gap-2 text-xs" disabled={!api} onClick={() => { if (api) resetVideoEditWorkspaceLayout(api) }}><RotateCcw size={13} />重置布局</UiOptionButton>
    </div>}>
    {({ open, togglePanel }) => <UiButton variant="plain" disabled={!api} className="gap-1.5" aria-expanded={open} data-panel-trigger-button onClick={togglePanel}><LayoutGrid size={15} />面板</UiButton>}
  </PanelTrigger>
}
