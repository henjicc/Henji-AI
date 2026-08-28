import { ChevronDown, MoreHorizontal, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import PanelTrigger from '@/components/ui/PanelTrigger'
import {
  UI_GLASS_ITEM_HOVER_CLASS,
  UI_TEXT_META_CLASS,
  UiChipButton,
  UiOptionButton,
} from '@/components/ui'
import {
  ICON_IMAGE_GLOW_PRO,
  ICON_MEDIA_IMAGE,
  ICON_NODE_ASSET_GROUP,
  ICON_NODE_CAMERA_STAGE,
  ICON_NODE_IMAGE_GENERATION,
  ICON_STORYBOARD,
  ICON_TOOL_IMAGE_EDIT,
} from '@/core/theme/icons'
import { Z_LAYERS } from '@/core/theme/zLayers'
import type {
  CanvasImageCapabilityDefinition,
  CanvasImageCapabilityIconKey,
  CanvasImageCapabilityId,
} from '@/features/canvas/capabilities'

import {
  NODE_TOOLBAR_BUTTON_RADIUS_CLASS,
  NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS,
} from './nodeToolbarConfig'
import { partitionCanvasImageCapabilities } from './canvasImageCapabilityLayout'

const CAPABILITY_ICON_MAP: Record<CanvasImageCapabilityIconKey, LucideIcon> = {
  panorama: ICON_MEDIA_IMAGE,
  relight: ICON_IMAGE_GLOW_PRO,
  multiAngle: ICON_NODE_CAMERA_STAGE,
  nineGrid: ICON_STORYBOARD,
  upscale: ICON_NODE_IMAGE_GENERATION,
  portraitTexture: ICON_TOOL_IMAGE_EDIT,
  elementEdit: ICON_TOOL_IMAGE_EDIT,
  layerSeparation: ICON_NODE_ASSET_GROUP,
  gridSplit: ICON_STORYBOARD,
}

interface CanvasImageCapabilityActionsProps {
  capabilities: readonly CanvasImageCapabilityDefinition[]
  pendingCapabilityId: CanvasImageCapabilityId | null
  onExecute: (capabilityId: CanvasImageCapabilityId) => void
}

export function CanvasImageCapabilityActions({
  capabilities,
  pendingCapabilityId,
  onExecute,
}: CanvasImageCapabilityActionsProps): JSX.Element | null {
  const { t } = useTranslation()
  const partition = partitionCanvasImageCapabilities(capabilities)

  if (capabilities.length === 0) return null

  const renderInlineCapability = (capability: CanvasImageCapabilityDefinition): JSX.Element => {
    const Icon = CAPABILITY_ICON_MAP[capability.icon]
    return (
      <UiChipButton
        key={capability.id}
        type="button"
        disabled={pendingCapabilityId !== null}
        aria-label={t(capability.titleKey)}
        title={t(capability.descriptionKey)}
        className={`h-8 ${NODE_TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
        onClick={(event) => {
          event.stopPropagation()
          onExecute(capability.id)
        }}
      >
        <Icon className="h-3.5 w-3.5" />
        {t(capability.titleKey)}
      </UiChipButton>
    )
  }

  return (
    <>
      {partition.inline.map(renderInlineCapability)}
      {partition.overflowGroups.length > 0 && (
        <PanelTrigger
          alignment="aboveCenter"
          gap={8}
          panelWidth={240}
          zIndex={Z_LAYERS.dropdown}
          closeOnPanelClick
          renderPanel={() => (
            <div className="space-y-2 p-2">
              {partition.overflowGroups.map((group) => (
                <div key={group.group} className="space-y-1">
                  <div className={`px-2 py-1 ${UI_TEXT_META_CLASS}`}>
                    {t(group.labelKey)}
                  </div>
                  {group.capabilities.map((capability) => {
                    const Icon = CAPABILITY_ICON_MAP[capability.icon]
                    return (
                      <UiOptionButton
                        key={capability.id}
                        type="button"
                        variant="menu"
                        disabled={pendingCapabilityId !== null}
                        title={t(capability.descriptionKey)}
                        className={`h-9 w-full gap-2 text-sm ${UI_GLASS_ITEM_HOVER_CLASS}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onExecute(capability.id)
                        }}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="truncate">{t(capability.titleKey)}</span>
                      </UiOptionButton>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        >
          {({ open, togglePanel }) => (
            <UiChipButton
              type="button"
              data-panel-trigger-button
              disabled={pendingCapabilityId !== null}
              aria-expanded={open}
              aria-label={t('nodeToolbar.moreImageCapabilities')}
              title={t('nodeToolbar.moreImageCapabilities')}
              className={`h-8 ${NODE_TOOLBAR_BUTTON_RADIUS_CLASS} gap-1 px-2.5 text-xs ${NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
              onClick={(event) => {
                event.stopPropagation()
                togglePanel()
              }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              {t('nodeToolbar.more')}
              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </UiChipButton>
          )}
        </PanelTrigger>
      )}
    </>
  )
}
