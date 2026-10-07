import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, LayoutGrid, Maximize2, Menu, Minimize2, RotateCcw } from 'lucide-react'
import type { DockviewApi, DockviewGroupPanel, IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'
import { PanelTrigger, UiIconButton, UiOptionButton } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { toggleDockGroupMaximized } from '@/components/dockviewDocking'
import { showVideoEditPanel, VIDEO_EDIT_PANELS } from './videoEditDockLayout'
import { dockVideoEditPopout, isVideoEditPanelPoppedOut, isVideoEditPopoutPanel, popOutVideoEditGroup, popOutVideoEditPanel, resetVideoEditWorkspaceLayout, subscribeVideoEditPopouts, videoEditPopoutRevision } from './popout/videoEditPopouts'

function useDockGroupMaximized(containerApi: DockviewApi, group: DockviewGroupPanel): boolean {
  const [maximized, setMaximized] = useState(group.api.isMaximized())
  useEffect(() => {
    setMaximized(group.api.isMaximized())
    const event = containerApi.onDidMaximizedGroupChange(() => setMaximized(group.api.isMaximized()))
    return () => event.dispose()
  }, [containerApi, group])
  return maximized
}
const maximizeLabelOf = (maximized: boolean): string => maximized ? '恢复面板组大小' : '最大化面板组'

export function VideoEditDockTab({ api, containerApi }: IDockviewPanelHeaderProps): React.ReactElement {
  const [title, setTitle] = useState(api.title ?? '')
  const [group, setGroup] = useState(api.group)
  const [active, setActive] = useState(api.group.activePanel?.id === api.id)
  useEffect(() => { const event = api.onDidTitleChange(value => setTitle(value.title)); return () => event.dispose() }, [api])
  useEffect(() => { setGroup(api.group); const event = api.onDidGroupChange(() => setGroup(api.group)); return () => event.dispose() }, [api])
  useEffect(() => {
    setActive(group.activePanel?.id === api.id)
    const event = group.api.onDidActivePanelChange(() => setActive(group.activePanel?.id === api.id))
    return () => event.dispose()
  }, [api, group])
  // 文字色交给 dockview 的标签色变量（选中主要文字、其余辅助文字，见 index.css 面板标签映射）
  // 与 PR 一致：标签只有标题和紧跟其后的面板菜单（关闭在菜单里），选中线只到菜单为止。
  // 非当前标签也占住菜单的位置（不可见），切换叠放面板时各标签文字位置不动。
  return <span className="flex h-full items-center gap-1 text-xs" data-dock-tab={api.id} data-dock-tab-title={title}>
    <span>{title}</span>
    {active ? <VideoEditPanelMenu containerApi={containerApi} group={group} /> : <span aria-hidden="true" className="invisible flex"><UiIconButton size="xs" tabIndex={-1}><Menu size={12} /></UiIconButton></span>}
  </span>
}

/**
 * 面板组菜单，叫法与 PR 一致（剪辑对齐 PR 1.1）。“浮动”即浮出为独立系统窗口（重要记录 001）；
 * 一个窗口放多个面板不在本期，浮动面板组时组内每个面板各开一个窗口。
 */
function VideoEditPanelMenu({ containerApi, group }: { containerApi: DockviewApi; group: DockviewGroupPanel }): React.ReactElement {
  const maximized = useDockGroupMaximized(containerApi, group)
  const toggleMaximized = (): void => { toggleDockGroupMaximized(containerApi, undefined, group) }
  return <PanelTrigger panelWidth={196} zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu"
    renderPanel={() => {
      const { activePanel, panels } = group
      const canFloatPanel = Boolean(activePanel && isVideoEditPopoutPanel(activePanel.id))
      const canFloatGroup = panels.some(panel => isVideoEditPopoutPanel(panel.id))
      return <div className="flex flex-col gap-1" role="menu" aria-label="面板菜单">
        <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={!activePanel} onClick={() => activePanel?.api.close()}>关闭面板</UiOptionButton>
        <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={!canFloatPanel} onClick={() => { if (activePanel && isVideoEditPopoutPanel(activePanel.id)) popOutVideoEditPanel(containerApi, activePanel.id) }}>浮动面板</UiOptionButton>
        <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={panels.length < 2 || !activePanel} onClick={() => panels.filter(panel => panel !== activePanel).forEach(panel => panel.api.close())}>关闭组中的其他面板</UiOptionButton>
        <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={!canFloatGroup} onClick={() => popOutVideoEditGroup(containerApi, group)}>浮动面板组</UiOptionButton>
        <UiOptionButton role="menuitem" variant="menu" size="sm" disabled={group.api.location.type !== 'grid' || (!maximized && containerApi.groups.length < 2)} onClick={toggleMaximized}>{maximizeLabelOf(maximized)}</UiOptionButton>
        <UiOptionButton role="menuitem" variant="menu" size="sm" onClick={() => group.api.close()}>关闭面板组</UiOptionButton>
        <UiOptionButton role="menuitem" variant="menu" size="sm" onClick={() => resetVideoEditWorkspaceLayout(containerApi)}>重置布局</UiOptionButton>
      </div>
    }}>
    {({ open, togglePanel }) => <UiIconButton size="xs" title="面板菜单" aria-label="面板菜单" aria-haspopup="menu" aria-expanded={open} on={open} data-panel-trigger-button
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); togglePanel() }}><Menu size={12} /></UiIconButton>}
  </PanelTrigger>
}

/** 面板头右端只留最大化／恢复（悬停面板组时出现）；面板菜单在当前标签标题旁。 */
export function VideoEditDockHeaderActions({ api, containerApi, group }: IDockviewHeaderActionsProps): React.ReactElement {
  const maximized = useDockGroupMaximized(containerApi, group)
  const label = maximizeLabelOf(maximized)
  return <div className="flex h-full items-center gap-1 pr-1" data-video-edit-dock-actions>
    {api.location.type === 'grid' && <UiIconButton size="sm" title={label} aria-label={label} onClick={() => toggleDockGroupMaximized(containerApi, undefined, group)}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</UiIconButton>}
  </div>
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
