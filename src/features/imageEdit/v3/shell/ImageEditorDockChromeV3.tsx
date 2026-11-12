import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'

import { toggleDockGroupMaximized } from '@/components/dockviewDocking'
import { UiIconButton } from '@/components/ui'
import { useAppMenuVisibility } from '@/components/appMenu/appMenuVisibility'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import { showImageEditorPanelV3 } from '../panelFramework/layout'
import { useImageEditorShellV3 } from './ImageEditorShellContextV3'

/** 面板标签只写标题：面板的开关在窗口菜单与面板菜单里，标签上不放关闭叉（与剪辑、镜头参考的面板一致）。 */
export function ImageEditorDockTabV3({ api }: IDockviewPanelHeaderProps): JSX.Element {
  const [title, setTitle] = useState(api.title ?? '')
  useEffect(() => {
    const event = api.onDidTitleChange(value => setTitle(value.title))
    return () => event.dispose()
  }, [api])
  return (
    <span className="flex h-full items-center px-1 text-xs" data-dock-tab={api.id}>
      <span>{title}</span>
    </span>
  )
}

export function ImageEditorDockHeaderActionsV3({ group, containerApi }: IDockviewHeaderActionsProps): JSX.Element | null {
  const { t } = useTranslation('ui')
  const { collapsed, toggleCollapsed } = useImageEditorShellV3()
  const [maximized, setMaximized] = useState(group.api.isMaximized())
  const [, refresh] = useState(0)
  useEffect(() => {
    const event = containerApi.onDidMaximizedGroupChange(() => setMaximized(group.api.isMaximized()))
    return () => event.dispose()
  }, [containerApi, group])
  useEffect(() => {
    const events = [containerApi.onDidActivePanelChange(() => refresh(value => value + 1)), containerApi.onDidLayoutChange(() => refresh(value => value + 1))]
    return () => events.forEach(event => event.dispose())
  }, [containerApi])
  if (group.panels.some(panel => panel.id === 'preview')) return null
  const title = t(maximized ? 'imageEditor.v3.panels.restoreSize' : 'imageEditor.v3.panels.maximize', {
    defaultValue: maximized ? '恢复面板大小' : '最大化面板',
  })
  const isCollapsed = group.panels.some(panel => collapsed.has(panel.id))
  const groupTitle = group.activePanel?.title ?? ''
  return <div className="flex h-full items-center pr-1">
    <UiIconButton size="xs" aria-label={t(isCollapsed ? 'imageEditor.v3.panels.expand' : 'imageEditor.v3.panels.collapse', { title: groupTitle })}
      tooltip={t(isCollapsed ? 'imageEditor.v3.panels.expand' : 'imageEditor.v3.panels.collapse', { title: groupTitle })}
      aria-expanded={!isCollapsed} onClick={() => {
        for (const panel of group.panels) if (collapsed.has(panel.id) === isCollapsed) toggleCollapsed(panel.id)
      }}>{isCollapsed ? <ChevronDown  /> : <ChevronUp  />}</UiIconButton>
    <UiIconButton size="xs" aria-label={title} tooltip={title}
      onClick={() => toggleDockGroupMaximized(containerApi, undefined, group)}>
      {maximized ? <Minimize2  /> : <Maximize2  />}
    </UiIconButton>
  </div>
}

/**
 * 面板的显示与关闭进标题栏“窗口”菜单（与剪辑一致），不在命令带上另放一个和布局菜单长得一样的按钮。
 * 所有面板都关掉时仍能从这里重开；恢复默认布局在“工作区布局”里。
 */
export function ImageEditorPanelWindowMenuV3(): null {
  const { t } = useTranslation('ui')
  const visible = useAppMenuVisibility()
  const { api, panels } = useImageEditorShellV3()
  const [revision, refresh] = useState(0)
  useEffect(() => {
    if (!api) return
    const events = [api.onDidLayoutChange(() => refresh(value => value + 1))]
    return () => events.forEach(event => event.dispose())
  }, [api])
  useEffect(() => {
    if (!visible || !api || !panels.length) return undefined
    const title = (definition: typeof panels[number]): string => t(definition.titleKey, { defaultValue: definition.title })
    const open = panels.filter(definition => api.getPanel(definition.id))
    return contributeAppMenus('imageEdit.panels', [
      { menu: 'window', order: 110, items: panels.map(definition => ({
        kind: 'action' as const, id: `imageEdit.panel.${definition.id}`, label: title(definition), checked: Boolean(api.getPanel(definition.id)),
        run: () => { const panel = api.getPanel(definition.id); if (panel) panel.api.close(); else showImageEditorPanelV3(api, definition, title(definition)) },
      })) },
      ...(open.length ? [{ menu: 'window' as const, order: 111, items: [{
        kind: 'submenu' as const, id: 'imageEdit.panel.float', label: t('imageEditor.v3.panels.floatMenu', { defaultValue: '浮动面板' }),
        items: open.map(definition => {
          const panel = api.getPanel(definition.id)!
          const floating = panel.group.api.location.type === 'floating'
          return { kind: 'action' as const, id: `imageEdit.panel.float.${definition.id}`, label: title(definition), checked: floating, run: () => {
            if (floating) panel.api.moveTo({ group: api.getPanel('preview')?.group, position: 'right' })
            else api.addFloatingGroup(panel, { width: api.width > 0 ? Math.min(400, api.width * 0.6) : 400, height: api.height > 0 ? Math.min(480, api.height * 0.8) : 480 })
          } }
        }),
      }] }] : []),
    ])
  }, [visible, api, panels, revision, t])
  return null
}
