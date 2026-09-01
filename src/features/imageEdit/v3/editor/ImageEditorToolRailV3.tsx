import {
  ArrowUpRight,
  Brush,
  Circle,
  CircleDashed,
  Crop,
  Eraser,
  Hand,
  LassoSelect,
  Paintbrush,
  ListOrdered,
  MessageSquareText,
  Move,
  Scan,
  Square,
  Type,
  VectorSquare,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { UiIconButton } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'
import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorSessionStoreV3 } from '../store'
import { resolveImageEditorReadinessReasonV3 } from './readinessPresentationV3'
import type { ImageEditorV3Controller } from './types'

const TOOL_ICONS: Record<ImageEditorToolIdV3, LucideIcon> = {
  move: Move,
  hand: Hand,
  zoom: ZoomIn,
  crop: Crop,
  'select-rect': VectorSquare,
  'select-ellipse': Scan,
  'select-lasso': LassoSelect,
  'annotation-text': Type,
  'annotation-callout': MessageSquareText,
  'annotation-arrow': ArrowUpRight,
  'annotation-rect': Square,
  'annotation-ellipse': Circle,
  'annotation-number': ListOrdered,
  'annotation-pen': Brush,
  'raster-brush': Paintbrush,
  eraser: Eraser,
  'mask-edit': CircleDashed,
}

const TOOL_GROUPS: readonly (readonly ImageEditorToolIdV3[])[] = [
  ['move', 'hand', 'zoom'],
  ['crop', 'select-rect', 'select-ellipse', 'select-lasso'],
  [
    'annotation-text',
    'annotation-callout',
    'annotation-arrow',
    'annotation-rect',
    'annotation-ellipse',
    'annotation-number',
    'annotation-pen',
  ],
  ['raster-brush', 'eraser', 'mask-edit'],
]

export function ImageEditorToolRailV3({ controller }: { controller: ImageEditorV3Controller }): JSX.Element {
  const { t } = useTranslation('ui')
  const activeTool = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.activeTool,
  )
  const setActiveTool = useImageEditorSessionStoreV3((state) => state.setActiveTool)
  const capabilities = new Map(controller.profile.tools.map((capability) => [
    capability.id,
    capability,
  ]))

  return (
    <nav
      aria-label={t('imageEditor.v3.tools.label')}
      className="flex w-12 shrink-0 flex-col items-center border-r border-border-dark bg-panel py-2"
    >
      {TOOL_GROUPS.map((group, groupIndex) => {
        const tools = group.flatMap((tool) => {
          const capability = capabilities.get(tool)
          return capability ? [capability] : []
        })
        if (tools.length === 0) return null
        return (
          <div
            key={group[0]}
            role="toolbar"
            aria-orientation="vertical"
            className={`flex flex-col gap-1 ${groupIndex > 0 ? 'mt-2 pt-2' : ''}`}
          >
            {tools.map(({ id, readiness }) => {
              const Icon = TOOL_ICONS[id]
              const label = t(`imageEditor.v3.tools.${id}`)
              const disabled = readiness.state !== 'ready'
              const reason = resolveImageEditorReadinessReasonV3(readiness, t)
              const unavailableLabel = reason
                ? t('imageEditor.v3.readiness.unavailableWithReason', { label, reason })
                : t('imageEditor.v3.readiness.unavailable', { label })
              return (
                <Tooltip key={id} content={disabled ? unavailableLabel : label} delay={180}>
                  <UiIconButton
                    data-tool-id={id}
                    data-tool-readiness={readiness.state}
                    className="h-8 w-8"
                    showBorder={false}
                    appearance="hover-only"
                    active={activeTool === id}
                    disabled={disabled}
                    aria-label={disabled ? unavailableLabel : label}
                    aria-pressed={activeTool === id}
                    onClick={() => setActiveTool(controller.sessionId, id)}
                  >
                  <Icon className="h-4 w-4" />
                  </UiIconButton>
                </Tooltip>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}
