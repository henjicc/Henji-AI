import {
  ArrowUpRight,
  CircleDashed,
  Crop,
  Eraser,
  Hand,
  LassoSelect,
  Paintbrush,
  MessageSquareText,
  Move,
  Scan,
  VectorSquare,
  ZoomIn,
  WandSparkles,
  Bandage,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PanelTrigger, UiIconButton, UiOptionButton } from '@/components/ui'
import Tooltip from '@/components/ui/Tooltip'
import type {
  ImageEditorCapabilityV3,
  ImageEditorToolIdV3,
} from '../application/imageEditorHostProfiles'
import { useImageEditorSessionStoreV3 } from '../store'
import { IMAGE_EDITOR_ANNOTATION_TOOL_IDS_V3 } from './annotationToolsV3'
import { resolveImageEditorReadinessReasonV3 } from './readinessPresentationV3'
import { resolveImageEditorRasterBrushLayerV3 } from './rasterBrushLayerV3'
import type { ImageEditorV3Controller } from './types'

const TOOL_ICONS: Record<ImageEditorToolIdV3, LucideIcon> = {
  move: Move,
  hand: Hand,
  zoom: ZoomIn,
  crop: Crop,
  'select-rect': VectorSquare,
  'select-ellipse': Scan,
  'select-lasso': LassoSelect,
  'select-polygon': LassoSelect,
  'select-brush': Paintbrush,
  'select-subject': WandSparkles,
  'select-subject-box': Scan,
  remove: WandSparkles,
  repair: Bandage,
  'annotation-text': MessageSquareText,
  'annotation-callout': MessageSquareText,
  'annotation-arrow': ArrowUpRight,
  'annotation-rect': MessageSquareText,
  'annotation-ellipse': MessageSquareText,
  'annotation-number': MessageSquareText,
  'annotation-pen': MessageSquareText,
  'annotation-mosaic': MessageSquareText,
  'raster-brush': Paintbrush,
  eraser: Eraser,
  'mask-edit': CircleDashed,
}

type ToolRailEntryV3 = ImageEditorToolIdV3 | 'annotation' | 'selection'
type RenderableToolRailEntryV3 =
  | { id: ImageEditorToolIdV3; annotationTools: null }
  | {
    id: 'annotation'
    annotationTools: ImageEditorCapabilityV3<ImageEditorToolIdV3>[]
  }
  | { id: 'selection'; annotationTools: null }

const TOOL_GROUPS: readonly (readonly ToolRailEntryV3[])[] = [
  ['move', 'hand', 'zoom'],
  ['crop'],
  ['selection'],
  ['remove', 'repair'],
  ['annotation'],
  ['raster-brush', 'eraser', 'mask-edit'],
]

export function ImageEditorToolRailV3({ controller }: { controller: ImageEditorV3Controller }): JSX.Element {
  const { t } = useTranslation('ui')
  const session = useImageEditorSessionStoreV3((state) => state.sessions[controller.sessionId])
  const activeTool = session?.activeTool
  const rasterBrushTarget = resolveImageEditorRasterBrushLayerV3(
    controller.document,
    session?.selectedLayerIds ?? [],
  )
  const setActiveTool = useImageEditorSessionStoreV3((state) => state.setActiveTool)
  const capabilities = new Map(controller.profile.tools.map((capability) => [
    capability.id,
    capability,
  ]))

  return (
    <nav
      aria-label={t('imageEditor.v3.tools.label')}
      className="flex w-12 shrink-0 flex-col items-center border-r border-gap bg-panel py-2"
    >
      {TOOL_GROUPS.map((group, groupIndex) => {
        const tools: RenderableToolRailEntryV3[] = []
        group.forEach((tool) => {
          if (tool === 'selection') {
            const selectionTools = controller.profile.tools.filter(({ id }) => id.startsWith('select-'))
            if (controller.profile.id === 'mask') selectionTools.forEach(capability => tools.push({ id: capability.id, annotationTools: null }))
            else if (selectionTools.length) tools.push({ id: 'selection', annotationTools: null })
            return
          }
          if (tool === 'annotation') {
            const annotationTools = IMAGE_EDITOR_ANNOTATION_TOOL_IDS_V3.flatMap((id) => {
              const capability = capabilities.get(id)
              return capability ? [capability] : []
            })
            if (annotationTools.length > 0) tools.push({ id: 'annotation', annotationTools })
            return
          }
          const capability = capabilities.get(tool)
          if (capability) tools.push({ id: capability.id, annotationTools: null })
        })
        if (tools.length === 0) return null
        return (
          <div
            key={group[0]}
            role="toolbar"
            aria-orientation="vertical"
            className={`flex flex-col gap-1 ${groupIndex > 0 ? 'mt-2 pt-2' : ''}`}
          >
            {tools.map(({ id, annotationTools }) => {
              if (id === 'selection') {
                const selectionTools = controller.profile.tools.filter(({ id: toolId }) => toolId.startsWith('select-'))
                const current = selectionTools.find(({ id: toolId }) => toolId === activeTool) ?? selectionTools[0]
                const Icon = TOOL_ICONS[current.id]
                return <PanelTrigger key={id} panelWidthLabels={selectionTools.map(({ id: toolId }) => t(`imageEditor.v3.tools.${toolId}`))} closeOnPanelClick renderPanel={() => <div className="flex flex-col gap-0.5 p-1" role="menu" aria-label={t('imageEditor.v3.selection.overlay')}>
                  {selectionTools.map(({ id: toolId, readiness }) => <UiOptionButton key={toolId} role="menuitem" variant="menu" active={activeTool === toolId} disabled={readiness.state !== 'ready'} onClick={() => setActiveTool(controller.sessionId, toolId)}>{t(`imageEditor.v3.tools.${toolId}`)}</UiOptionButton>)}
                </div>}>
                  {({ togglePanel, open }) => <UiIconButton size="lg" data-tool-id={current.id} on={activeTool?.startsWith('select-')} aria-label={t(`imageEditor.v3.tools.${current.id}`)} aria-expanded={open} title={t(`imageEditor.v3.tools.${current.id}`)} onClick={togglePanel}><Icon className="h-4 w-4" /></UiIconButton>}
                </PanelTrigger>
              }
              const isAnnotation = id === 'annotation'
              const targetTool = isAnnotation
                ? annotationTools?.find(({ id: toolId }) => toolId === session?.toolSettings.annotationTool)
                  ?? annotationTools?.[0]
                : null
              if (isAnnotation && !targetTool) return null
              const readiness = isAnnotation ? targetTool!.readiness : capabilities.get(id)!.readiness
              const Icon = isAnnotation ? MessageSquareText : TOOL_ICONS[id]
              const label = t(`imageEditor.v3.tools.${id}`)
              const isRasterPaint = id === 'raster-brush' || id === 'eraser' || id === 'remove' || id === 'repair'
              const disabled = readiness.state !== 'ready' || (isRasterPaint && !rasterBrushTarget.ready)
              const reason = resolveImageEditorReadinessReasonV3(readiness, t)
              const unavailableLabel = reason
                ? t('imageEditor.v3.readiness.unavailableWithReason', { label, reason })
                : t('imageEditor.v3.readiness.unavailable', { label })
              return (
                <Tooltip
                  key={id}
                  content={disabled ? unavailableLabel : label}
                  delay={180}
                  anchor="pointer-start"
                >
                  <UiIconButton size="lg"
                    data-tool-id={id}
                    data-tool-readiness={disabled ? 'disabled' : readiness.state}
                    on={isAnnotation ? activeTool?.startsWith('annotation-') : activeTool === id}
                    disabled={disabled}
                    aria-label={disabled ? unavailableLabel : label}
                    aria-pressed={isAnnotation ? activeTool?.startsWith('annotation-') : activeTool === id}
                    onClick={() => setActiveTool(controller.sessionId, isAnnotation ? targetTool!.id : id)}
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
