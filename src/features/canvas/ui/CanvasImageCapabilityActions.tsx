import {
  ChevronDown,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
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
  ICON_STORYBOARD,
  ICON_TOOL_IMAGE_EDIT,
  ICON_UPSCALE,
} from '@/core/theme/icons'
import { Z_LAYERS } from '@/core/theme/zLayers'
import type {
  CanvasImageCapabilityIconKey,
  CanvasImageCapabilityId,
} from '@/features/canvas/capabilities'

import {
  NODE_TOOLBAR_BUTTON_RADIUS_CLASS,
  NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS,
} from './nodeToolbarConfig'
import {
  partitionCanvasImageCapabilities,
  resolveCanvasImageCapabilityInlineCapacity,
  resolveCanvasImageCapabilityMenuFocusIndex,
  type CanvasImageCapabilityAction,
  type CanvasImageCapabilityMenuNavigationKey,
} from './canvasImageCapabilityLayout'

const CAPABILITY_ICON_MAP: Record<CanvasImageCapabilityIconKey, LucideIcon> = {
  panorama: ICON_MEDIA_IMAGE,
  relight: ICON_IMAGE_GLOW_PRO,
  multiAngle: ICON_NODE_CAMERA_STAGE,
  nineGrid: ICON_STORYBOARD,
  upscale: ICON_UPSCALE,
  portraitTexture: ICON_TOOL_IMAGE_EDIT,
  elementEdit: ICON_TOOL_IMAGE_EDIT,
  layerSeparation: ICON_NODE_ASSET_GROUP,
  gridSplit: ICON_STORYBOARD,
}

interface CanvasImageCapabilityActionsProps {
  actions: readonly CanvasImageCapabilityAction[]
  pendingCapabilityId: CanvasImageCapabilityId | null
  onExecute: (capabilityId: CanvasImageCapabilityId) => void
}

export function CanvasImageCapabilityActions({
  actions,
  pendingCapabilityId,
  onExecute,
}: CanvasImageCapabilityActionsProps): JSX.Element | null {
  const { t } = useTranslation()
  const [inlineCapacity, setInlineCapacity] = useState(() => (
    typeof window === 'undefined'
      ? 4
      : resolveCanvasImageCapabilityInlineCapacity(window.innerWidth)
  ))
  const menuRef = useRef<HTMLDivElement | null>(null)
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const closeMenuRef = useRef<() => void>(() => undefined)
  const shouldFocusMenuRef = useRef(false)
  const partition = partitionCanvasImageCapabilities(actions, inlineCapacity)

  useEffect(() => {
    const handleResize = (): void => {
      setInlineCapacity(resolveCanvasImageCapabilityInlineCapacity(window.innerWidth))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const setMenuElement = useCallback((element: HTMLDivElement | null): void => {
    menuRef.current = element
    if (!element || !shouldFocusMenuRef.current) return
    shouldFocusMenuRef.current = false
    window.requestAnimationFrame(() => {
      element.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    })
  }, [])

  const handleMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenuRef.current()
      window.setTimeout(() => moreButtonRef.current?.focus(), 210)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    )
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = resolveCanvasImageCapabilityMenuFocusIndex(
      currentIndex,
      items.length,
      event.key as CanvasImageCapabilityMenuNavigationKey,
    )
    if (nextIndex < 0) return
    event.preventDefault()
    items[nextIndex]?.focus()
  }, [])

  if (actions.length === 0) return null

  const renderInlineCapability = ({ capability }: CanvasImageCapabilityAction): JSX.Element => {
    const Icon = CAPABILITY_ICON_MAP[capability.icon]
    return (
      <UiChipButton
        key={capability.id}
        type="button"
        data-image-capability-id={capability.id}
        data-image-capability-placement="inline"
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
          alignment="bottomLeft"
          gap={8}
          panelWidth={320}
          zIndex={Z_LAYERS.dropdown}
          closeOnPanelClick={(target) => {
            const element = target instanceof Element ? target : target.parentElement
            return Boolean(element?.closest('[data-capability-enabled="true"]'))
          }}
          renderPanel={() => (
            <div
              ref={setMenuElement}
              role="menu"
              aria-label={t('nodeToolbar.moreImageCapabilities')}
              data-image-capability-menu="true"
              className="space-y-2 p-2"
              onKeyDown={handleMenuKeyDown}
            >
              {partition.overflowGroups.map((group) => (
                <div key={group.group} className="space-y-1">
                  <div className={`px-2 py-1 ${UI_TEXT_META_CLASS}`}>
                    {t(group.labelKey)}
                  </div>
                  {group.actions.map(({ capability, disabledReasonKey }) => {
                    const Icon = CAPABILITY_ICON_MAP[capability.icon]
                    const disabled = pendingCapabilityId !== null || disabledReasonKey !== null
                    return (
                      <UiOptionButton
                        key={capability.id}
                        type="button"
                        variant="menu"
                        role="menuitem"
                        aria-disabled={disabled}
                        data-capability-enabled={disabled ? 'false' : 'true'}
                        data-image-capability-id={capability.id}
                        data-image-capability-placement="overflow"
                        title={t(capability.descriptionKey)}
                        className={`min-h-12 w-full items-start gap-2 px-2 py-2 text-left text-sm ${disabled ? 'cursor-not-allowed opacity-50 hover:!border-transparent hover:!bg-transparent' : UI_GLASS_ITEM_HOVER_CLASS}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (disabled) return
                          onExecute(capability.id)
                        }}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{t(capability.titleKey)}</span>
                            {capability.availability.releaseStage === 'experimental' && (
                              <span className="shrink-0 rounded border border-border-dark px-1 py-0.5 text-3xs leading-none text-text-muted">
                                {t('imageCapabilities.status.experimental')}
                              </span>
                            )}
                          </span>
                          <span className={`mt-0.5 block whitespace-normal leading-4 ${UI_TEXT_META_CLASS}`}>
                            {disabledReasonKey
                              ? t(disabledReasonKey)
                              : t(capability.descriptionKey)}
                          </span>
                        </span>
                      </UiOptionButton>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        >
          {({ open, closePanel, togglePanel }) => {
            closeMenuRef.current = closePanel
            return (
            <UiChipButton
              ref={moreButtonRef}
              type="button"
              data-panel-trigger-button
              data-image-capability-more="true"
              disabled={pendingCapabilityId !== null}
              aria-expanded={open}
              aria-haspopup="menu"
              aria-label={t('nodeToolbar.moreImageCapabilities')}
              title={t('nodeToolbar.moreImageCapabilities')}
              className={`h-8 ${NODE_TOOLBAR_BUTTON_RADIUS_CLASS} gap-1 px-2.5 text-xs ${NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
              onClick={(event) => {
                event.stopPropagation()
                if (!open) shouldFocusMenuRef.current = true
                togglePanel()
              }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              {t('nodeToolbar.more')}
              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </UiChipButton>
            )
          }}
        </PanelTrigger>
      )}
    </>
  )
}
