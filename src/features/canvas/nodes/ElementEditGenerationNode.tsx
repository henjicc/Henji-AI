import { memo, useCallback, useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'

import { prepareLocalRedraw, readImageInfo } from '@/commands/image'
import { registry } from '@/core/ModelRegistry'
import { getSupportedAspectRatios } from '@/core/params/ratioResolution'
import { ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons'
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  normalizeLocalRedrawSettings,
  prepareElementEditPreflight,
} from '@/features/canvas/capabilities'
import {
  commitLocalRedrawGeneration,
  LOCAL_REDRAW_CONTEXT_FIELD,
  parseLocalRedrawContext,
} from '@/features/canvas/application/localRedrawGenerationService'
import { CANVAS_NODE_TYPES, type ElementEditGenerationNodeData } from '@/features/canvas/domain/canvasNodes'
import {
  GenerationNodeShell,
  type GenerationNodeRequestPreparation,
  type GenerationNodeResultCommitContext,
  type GenerationNodeRuntimePreparationContext,
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

  const prepareRuntimeParams = useCallback(async ({
    data: runtimeData,
    images,
  }: GenerationNodeRuntimePreparationContext): Promise<DynamicValueMap> => {
    const latestData = runtimeData as ElementEditGenerationNodeData
    await prepareElementEditPreflight({
      images,
      maskSource: latestData.localRedrawMaskSource,
      maskDocument: latestData.localRedrawMaskDocument,
      readImageInfo,
    })
    return {}
  }, [])

  const prepareGenerationRequest = useCallback(async ({
    data: runtimeData,
    images,
    videos,
    audios,
    params,
    modelId,
  }: GenerationNodeRuntimePreparationContext): Promise<GenerationNodeRequestPreparation> => {
    const latestData = runtimeData as ElementEditGenerationNodeData
    const mask = latestData.localRedrawMaskSource
    if (!mask || !images[0]) throw new Error(t('node.elementEditGeneration.missingInput'))
    const model = registry.getModel(modelId)
    const prepared = await prepareLocalRedraw({
      source: images[0],
      mask,
      settings: normalizeLocalRedrawSettings(latestData.localRedrawSettings),
      preferredAspectRatios: model ? getSupportedAspectRatios(model.params) : undefined,
    })
    return {
      requestId: prepared.context.requestId,
      createdFilePaths: prepared.createdFilePaths,
      params,
      inputs: { images: [prepared.cropSource], videos, audios },
      resultNodeData: { [LOCAL_REDRAW_CONTEXT_FIELD]: prepared.context as unknown as DynamicValue },
    }
  }, [t])

  const commitGenerationResult = useCallback(async (context: GenerationNodeResultCommitContext) => {
    const localRedrawContext = parseLocalRedrawContext(context.resultNodeData[LOCAL_REDRAW_CONTEXT_FIELD])
    if (!localRedrawContext) throw new Error(t('node.elementEditGeneration.missingContext'))
    return await commitLocalRedrawGeneration({
      sourceNodeId: context.sourceNodeId,
      placeholderNodeId: context.placeholderNodeId,
      resultNodeType: context.resultNodeType,
      completionId: context.completionId,
      context: localRedrawContext,
      result: context.result,
    })
  }, [t])

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
      apiKeyRequiredKey="node.elementEditGeneration.apiKeyRequired"
      resultTitleKey="node.elementEditGeneration.resultTitle"
      prepareRuntimeParams={prepareRuntimeParams}
      prepareGenerationRequest={prepareGenerationRequest}
      commitGenerationResult={commitGenerationResult}
      additionalInputRows={settingsRows}
      layoutMode="workbench"
      workbenchMediaInput="image"
      workbenchStage={renderWorkbenchStage}
      minHeight={360}
    />
  )
})

ElementEditGenerationNode.displayName = 'ElementEditGenerationNode'
