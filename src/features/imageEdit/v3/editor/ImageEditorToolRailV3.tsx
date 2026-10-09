import { useTranslation } from 'react-i18next'
import { PanelTrigger, UiIconButton, UiOptionButton } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'
import { useImageEditorSessionStoreV3 } from '../store'
import { imageEditorToolRegistry } from '../toolFramework/builtInRegistry'
import { resolveImageEditorReadinessReasonV3 } from './readinessPresentationV3'
import { resolveImageEditorRasterBrushLayerV3 } from './rasterBrushLayerV3'
import type { ImageEditorV3Controller } from './types'

export function ImageEditorToolRailV3({ controller }: { controller: ImageEditorV3Controller }): JSX.Element {
  const { t } = useTranslation('ui')
  const session = useImageEditorSessionStoreV3(state => state.sessions[controller.sessionId])
  const setActiveTool = useImageEditorSessionStoreV3(state => state.setActiveTool)
  const rasterTarget = resolveImageEditorRasterBrushLayerV3(controller.document, session?.selectedLayerIds ?? [])
  const capabilities = new Map(controller.profile.tools.map(capability => [capability.id, capability]))
  const definitions = imageEditorToolRegistry.list().filter(tool => capabilities.has(tool.id))
  const groups = [...new Map(definitions.map(tool => [tool.group.id, tool.group])).values()].sort((a, b) => a.order - b.order)
  const available = (id: string): boolean => {
    const definition = imageEditorToolRegistry.get(id)
    return Boolean(definition && capabilities.get(definition.id)?.readiness.state === 'ready'
      && (!definition.requiresRasterTarget || rasterTarget.ready))
  }
  return <nav aria-label={t('imageEditor.v3.tools.label')} className="flex w-12 shrink-0 flex-col items-center overflow-y-auto border-r border-gap bg-panel py-2">
    {groups.map((group, index) => {
      const tools = definitions.filter(tool => tool.group.id === group.id)
      const collapsed = group.collapsed && !group.expandedProfiles?.includes(controller.profile.id)
      const current = tools.find(tool => tool.id === session?.activeTool)
        ?? tools.find(tool => tool.id === session?.toolSettings.annotationTool) ?? tools[0]
      const CurrentIcon = current.icon
      return <div key={group.id} role="toolbar" aria-orientation="vertical" className={`flex flex-col gap-1 ${index > 0 ? 'mt-2 pt-2' : ''}`}>
        {collapsed ? <PanelTrigger menuSelection="single" panelPadding="menu" panelWidthLabels={tools.map(tool => t(tool.labelKey))} closeOnPanelClick renderPanel={() =>
          <div role="menu" aria-label={t(group.labelKey ?? current.labelKey)} className="flex flex-col gap-0.5 p-1">
            {tools.map(tool => <UiOptionButton key={tool.id} variant="menu" role="menuitem" active={tool.id === session?.activeTool} disabled={!available(tool.id)} onClick={() => setActiveTool(controller.sessionId, tool.id)}>{t(tool.labelKey)}</UiOptionButton>)}
          </div>}>
          {({ togglePanel, open }) => <Tooltip content={t(group.labelKey ?? current.labelKey)} delay={180} anchor="pointer-start">
            <UiIconButton size="lg" data-panel-trigger-button data-tool-id={group.triggerId ?? current.id} on={tools.some(tool => tool.id === session?.activeTool)} aria-label={t(group.labelKey ?? current.labelKey)} aria-expanded={open} aria-pressed={tools.some(tool => tool.id === session?.activeTool)} onClick={() => { if (available(current.id)) setActiveTool(controller.sessionId, current.id); togglePanel() }}><CurrentIcon className="h-4 w-4" /></UiIconButton>
          </Tooltip>}
        </PanelTrigger> : tools.map(tool => {
          const Icon = tool.icon
          const disabled = !available(tool.id)
          const readiness = capabilities.get(tool.id)!.readiness
          const label = t(tool.labelKey)
          const reason = resolveImageEditorReadinessReasonV3(readiness, t)
          const text = disabled ? (reason ? t('imageEditor.v3.readiness.unavailableWithReason', { label, reason }) : t('imageEditor.v3.readiness.unavailable', { label })) : label
          return <Tooltip key={tool.id} content={tool.shortcut && !disabled ? `${text} (${tool.shortcut.replace('Key', '')})` : text} delay={180} anchor="pointer-start">
            <UiIconButton size="lg" data-tool-id={tool.id} data-tool-readiness={disabled ? 'disabled' : readiness.state} on={session?.activeTool === tool.id} disabled={disabled} aria-label={text} aria-pressed={session?.activeTool === tool.id} onClick={() => setActiveTool(controller.sessionId, tool.id)}><Icon className="h-4 w-4" /></UiIconButton>
          </Tooltip>
        })}
      </div>
    })}
  </nav>
}
