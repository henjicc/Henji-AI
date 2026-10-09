import { ChevronDown, ChevronUp, LayoutPanelLeft, Maximize2, Minimize2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'

import { toggleDockGroupMaximized } from '@/components/dockviewDocking'
import { PanelTrigger, UiIconButton, UiOptionButton } from '@/components/ui'
import { showImageEditorPanelV3 } from '../panelFramework/layout'
import { useImageEditorShellV3 } from './ImageEditorShellContextV3'

export function ImageEditorDockTabV3({ api }: IDockviewPanelHeaderProps): JSX.Element {
  const { t } = useTranslation('ui')
  const [title, setTitle] = useState(api.title ?? '')
  const [active, setActive] = useState(api.isVisible)
  useEffect(() => {
    const events = [api.onDidTitleChange(value => setTitle(value.title)), api.onDidVisibilityChange(value => setActive(value.isVisible))]
    setActive(api.isVisible)
    return () => events.forEach(event => event.dispose())
  }, [api])
  return (
    <span className="flex h-full items-center gap-1 text-xs" data-dock-tab={api.id}>
      <span>{title}</span>
      {active && <UiIconButton size="sm"
        aria-label={t('imageEditor.v3.panels.close', { defaultValue: '关闭{{title}}面板', title })}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); api.close() }}
      ><X className="h-3.5 w-3.5" /></UiIconButton>}
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
    <UiIconButton size="sm" aria-label={t(isCollapsed ? 'imageEditor.v3.panels.expand' : 'imageEditor.v3.panels.collapse', { title: groupTitle })}
      aria-expanded={!isCollapsed} onClick={() => {
        for (const panel of group.panels) if (collapsed.has(panel.id) === isCollapsed) toggleCollapsed(panel.id)
      }}>{isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}</UiIconButton>
    <UiIconButton size="sm" aria-label={title} title={title}
      onClick={() => toggleDockGroupMaximized(containerApi, undefined, group)}>
      {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
    </UiIconButton>
  </div>
}

/** 命令带内的持久入口：即使所有面板关闭，仍可重开或重置。 */
export function ImageEditorPanelMenuV3(): JSX.Element | null {
  const { t } = useTranslation('ui')
  const { api, panels, restoreDefault } = useImageEditorShellV3()
  const [, refresh] = useState(0)
  useEffect(() => {
    if (!api) return
    const events = [api.onDidLayoutChange(() => refresh(value => value + 1))]
    return () => events.forEach(event => event.dispose())
  }, [api])
  if (!panels.length) return null
  const label = t('imageEditor.v3.panels.menu', { defaultValue: '面板' })
  return <PanelTrigger panelWidth={196} panelPadding="menu" closeOnPanelClick
    renderPanel={() => <div className="flex flex-col gap-1" role="menu" aria-label={label}>
      {panels.map(definition => {
        const title = t(definition.titleKey, { defaultValue: definition.title })
        const panel = api?.getPanel(definition.id)
        return <div key={definition.id} className="flex flex-col gap-1">
          <UiOptionButton variant="menu" size="sm" role="menuitem" disabled={!api}
            onClick={() => {
              if (!api) return
              if (panel) panel.api.close()
              else showImageEditorPanelV3(api, definition, title)
            }}>
            {t(panel ? 'imageEditor.v3.panels.close' : 'imageEditor.v3.panels.show', {
              defaultValue: panel ? '关闭{{title}}面板' : '显示{{title}}面板', title,
            })}
          </UiOptionButton>
          {panel && <UiOptionButton variant="menu" size="sm" role="menuitem" onClick={() => {
            if (!api) return
            if (panel.group.api.location.type === 'floating') {
              panel.api.moveTo({ group: api.getPanel('preview')?.group, position: 'right' })
            } else {
              api.addFloatingGroup(panel, {
                width: api.width > 0 ? Math.min(400, api.width * 0.6) : 400,
                height: api.height > 0 ? Math.min(480, api.height * 0.8) : 480,
              })
            }
          }}>
            {t(panel.group.api.location.type === 'floating' ? 'imageEditor.v3.panels.dock' : 'imageEditor.v3.panels.float', {
              defaultValue: panel.group.api.location.type === 'floating' ? '停靠{{title}}面板' : '浮动{{title}}面板', title,
            })}
          </UiOptionButton>}
        </div>
      })}
      <UiOptionButton variant="menu" size="sm" role="menuitem" disabled={!api} onClick={restoreDefault}>
        {t('imageEditor.v3.panels.defaultLayout', { defaultValue: '恢复默认布局' })}
      </UiOptionButton>
    </div>}>
    {({ open, togglePanel }) => <UiIconButton size="lg" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} on={open}
      onClick={togglePanel}><LayoutPanelLeft className="h-4 w-4" /></UiIconButton>}
  </PanelTrigger>
}
