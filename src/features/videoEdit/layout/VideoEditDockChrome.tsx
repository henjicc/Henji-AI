import { useEffect, useState, useSyncExternalStore } from 'react'
import { Maximize2, Menu, Minimize2 } from 'lucide-react'
import type { DockviewApi, DockviewGroupPanel, IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'
import { PanelTrigger, UiIconButton, UiOptionButton } from '@/components/ui'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { toggleDockGroupMaximized } from '@/components/dockviewDocking'
import { showVideoEditPanel, VIDEO_EDIT_PANELS, type VideoEditPanelId } from './videoEditDockLayout'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility'
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

/** titleSlot：用别的内容代替面板名（时间线面板显示已打开的序列，与 PR 一致）。 */
export function VideoEditDockTab({ api, containerApi, titleSlot }: IDockviewPanelHeaderProps & { titleSlot?: React.ReactNode }): React.ReactElement {
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
  return <span className="flex h-full items-center gap-1.5 text-xs" data-dock-tab={api.id} data-dock-tab-title={title}>
    {titleSlot ?? <span>{title}</span>}
    {active ? <VideoEditPanelMenu containerApi={containerApi} group={group} /> : <span aria-hidden="true" className="invisible flex"><UiIconButton size="2xs" tabIndex={-1}><Menu  /></UiIconButton></span>}
  </span>
}

/**
 * 面板组菜单，叫法与 PR 一致（剪辑对齐 PR 1.1）。“浮动”即浮出为独立系统窗口（重要记录 001）；
 * 一个窗口放多个面板不在本期，浮动面板组时组内每个面板各开一个窗口。
 */
function VideoEditPanelMenu({ containerApi, group }: { containerApi: DockviewApi; group: DockviewGroupPanel }): React.ReactElement {
  const maximized = useDockGroupMaximized(containerApi, group)
  const toggleMaximized = (): void => { toggleDockGroupMaximized(containerApi, undefined, group) }
  return <PanelTrigger panelSize="menu" zIndex={Z_LAYERS.dropdown} closeOnPanelClick panelPadding="menu"
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
    {({ open, togglePanel }) => <UiIconButton size="2xs" tooltip="面板菜单" aria-label="面板菜单" aria-haspopup="menu" aria-expanded={open} on={open} data-panel-trigger-button
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); togglePanel() }}><Menu  /></UiIconButton>}
  </PanelTrigger>
}

/** 面板头右端只有最大化／恢复（重要记录 018/019：面板工具在各自的底栏右侧，标签行只放标签）；面板菜单在当前标签标题旁。 */
export function VideoEditDockHeaderActions({ api, containerApi, group }: IDockviewHeaderActionsProps): React.ReactElement {
  const maximized = useDockGroupMaximized(containerApi, group)
  const label = maximizeLabelOf(maximized)
  return <div className="flex h-full items-center gap-1 pr-1" data-video-edit-dock-actions>
    {api.location.type === 'grid' && <UiIconButton size="xs" tooltip={label} aria-label={label} onClick={() => toggleDockGroupMaximized(containerApi, undefined, group)}>{maximized ? <Minimize2  /> : <Maximize2  />}</UiIconButton>}
  </div>
}

/**
 * 标题栏“窗口”菜单里的面板开关（参照 PR）：列出剪辑的全部面板，打开的打勾；再点一次关闭，浮出的面板贴回主窗口。
 * 只在剪辑显示时声明；重置在上方“工作区布局”子菜单里。
 */
export function VideoEditWindowMenu({ api }: { api: DockviewApi | null }): null {
  const visible = useAppMenuVisibility()
  const [revision, refresh] = useState(0)
  const popouts = useSyncExternalStore(subscribeVideoEditPopouts, videoEditPopoutRevision)
  useEffect(() => {
    if (!api) return
    const events = [api.onDidAddPanel(() => refresh(value => value + 1)), api.onDidRemovePanel(() => refresh(value => value + 1))]
    return () => events.forEach(event => event.dispose())
  }, [api])
  useEffect(() => {
    if (!visible || !api) return undefined
    const toggle = (id: VideoEditPanelId): void => {
      // 浮出的面板再点一次即贴回主窗口，不会在 Dock 中再建第二份。
      if (isVideoEditPanelPoppedOut(id)) { dockVideoEditPopout(id); return }
      const existing = api.getPanel(id)
      if (existing) existing.api.close(); else showVideoEditPanel(api, id)
    }
    const panels = [...VIDEO_EDIT_PANELS].sort((a, b) => WINDOW_MENU_ORDER.indexOf(a.id) - WINDOW_MENU_ORDER.indexOf(b.id))
    return contributeAppMenus('videoEdit.panels', [
      { menu: 'window', order: 110, items: panels.map(panel => ({ kind: 'action' as const, id: `videoEdit.panel.${panel.id}`, label: panel.title, checked: Boolean(api.getPanel(panel.id)) || isVideoEditPanelPoppedOut(panel.id), run: () => toggle(panel.id) })) },
    ])
  }, [visible, api, revision, popouts])
  return null
}
/** 窗口菜单里按“看画面、剪、找素材、调参数、做包装、审片”排，和 PR 窗口菜单的分组习惯接近。 */
const WINDOW_MENU_ORDER: readonly VideoEditPanelId[] = ['program', 'source', 'timeline', 'project', 'effects', 'effects_library', 'title_templates', 'presets', 'style_kits', 'annotations', 'content', 'tracking', 'color_grade']
