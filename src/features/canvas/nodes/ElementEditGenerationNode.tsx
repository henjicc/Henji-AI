import { memo, useCallback, useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'

import { ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons'
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  normalizeLocalRedrawSettings,
} from '@/features/canvas/capabilities'
import { CANVAS_NODE_TYPES, type ElementEditGenerationNodeData } from '@/features/canvas/domain/canvasNodes'
import {
  GenerationNodeShell,
  type GenerationNodeShellData,
  type GenerationNodeWorkbenchContext,
} from '@/features/canvas/nodes/shared/GenerationNodeShell'
import { useCanvasStore } from '@/stores/canvasStore'
import { LocalRedrawSettingsRows } from './localRedraw/LocalRedrawSettingsRows'
import { LocalRedrawWorkbenchStage } from './localRedraw/LocalRedrawWorkbenchStage'
import type { MaskEditorDocument } from '@/features/maskEditor/types'
import { ToolWorkbenchSourcePreview } from './shared/ToolWorkbenchNodeFrame'

type ElementEditGenerationNodeProps = NodeProps & {
  id: string
  data: ElementEditGenerationNodeData
  selected?: boolean
}

const ElementEditIcon = ICON_TOOL_IMAGE_EDIT

export const ElementEditGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ElementEditGenerationNodeProps) => {
  const { t } = useTranslation()
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const settings = useMemo(() => normalizeLocalRedrawSettings(data.localRedrawSettings), [data.localRedrawSettings])

  const settingsRows = useMemo(() => (
    <LocalRedrawSettingsRows
      nodeId={id}
      settings={settings}
      onChange={(nextSettings) => updateNodeData(id, {
        localRedrawSettings: normalizeLocalRedrawSettings(nextSettings),
      })}
    />
  ), [id, settings, updateNodeData])

  const persistMask = useCallback(({ maskSource, document }: {
    maskSource: string | null
    document: MaskEditorDocument
  }) => updateNodeData(id, {
    localRedrawMaskSource: maskSource,
    localRedrawMaskDocument: document,
  }, { skipHistory: true }), [id, updateNodeData])

  const renderWorkbenchStage = useCallback((context: GenerationNodeWorkbenchContext) => {
    const sourceImage = context.images[0]
    if (!sourceImage) {
      return (
        <ToolWorkbenchSourcePreview
          source={sourceImage ?? null}
          alt={t('node.mediaRow.image')}
          icon={<ElementEditIcon className="h-8 w-8" />}
          emptyText={t('node.elementEditGeneration.missingInput')}
        />
      )
    }
    return (
      <LocalRedrawWorkbenchStage
        selected={Boolean(selected)}
        sourceImage={sourceImage}
        initialDocument={data.localRedrawMaskDocument}
        onPersist={persistMask}
      />
    )
  }, [data.localRedrawMaskDocument, persistMask, selected, t])

  return (
    <GenerationNodeShell
      id={id}
      nodeType={CANVAS_NODE_TYPES.elementEditGen}
      data={data as GenerationNodeShellData}
      selected={selected}
      width={width}
      height={height}
      icon={<ElementEditIcon className="h-4 w-4" />}
      capabilityId={CANVAS_IMAGE_CAPABILITY_IDS.elementEdit}
      promptPlaceholderKey="node.elementEditGeneration.promptPlaceholder"
      promptRequiredKey="node.elementEditGeneration.promptRequired"
      additionalInputRows={settingsRows}
      layoutMode="workbench"
      workbenchMediaInput="image"
      workbenchStage={renderWorkbenchStage}
      minHeight={360}
    />
  )
})

ElementEditGenerationNode.displayName = 'ElementEditGenerationNode'
