import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import { createLogger } from '@/core/logging'
import { ICON_NODE_TEXT_PROCESSING } from '@/core/theme/icons'

import { LLM_CONFIG_CHANGED_EVENT } from '@/core/llm/events'
import {
  createPlainTextPromptDocument,
} from '@/core/inputs/promptDocument'
import {
  createTextProcessingModelKey,
  getTextProcessingMediaKinds,
  listTextProcessingModels,
  resolveTextProcessingModel,
  TEXT_PROCESSING_CUSTOM_TEMPLATE_ID,
} from '@/features/canvas/application/textProcessing'
import {
  hasReachableNonDisplayConsumer,
  runCanvasNode,
} from '@/features/canvas/application/canvasExecutionService'
import {
  areMediaOutputListsEqual,
  collectInputMedia,
} from '@/features/canvas/application/graphMediaResolver'
import {
  areStringSetsEqual,
  areValueOverridesEqual,
  collectInputValues,
  getConnectedParamIds,
} from '@/features/canvas/application/graphValueResolver'
import {
  type TextProcessingNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes'
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex'
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay'
import {
  PROMPT_PARAM_ID,
  getSocketColor,
  type RowMediaKind,
} from '@/features/canvas/domain/socketTypes'
import { useNodeHandlesSync } from '@/features/canvas/hooks/useNodeHandlesSync'
import { MediaInputRow } from '@/features/canvas/params/MediaInputRow'
import { TextProcessingModelRow } from '@/features/canvas/params/TextProcessingModelRow'
import { GenerationPromptEditor } from '@/features/canvas/nodes/shared/GenerationPromptEditor'
import { useGenerationPromptDocument } from '@/features/canvas/nodes/shared/useGenerationPromptDocument'
import { useGenerationNodeMinimumHeight } from '@/features/canvas/nodes/shared/useGenerationNodeMinimumHeight'
import { TextProcessingSystemPromptEditor } from '@/features/canvas/nodes/textProcessing/TextProcessingSystemPromptEditor'
import { TextProcessingPromptTemplateSelector } from '@/features/canvas/nodes/textProcessing/TextProcessingPromptTemplateSelector'
import { useTextProcessingSystemPrompt } from '@/features/canvas/nodes/textProcessing/useTextProcessingSystemPrompt'
import { useTextProcessingExecution } from '@/features/canvas/nodes/textProcessing/useTextProcessingExecution'
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader'
import { NodeLodPlaceholder } from '@/features/canvas/ui/NodeLodPlaceholder'
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle'
import {
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_ROW_CLASS,
  NODE_ROW_CONTROL_SLOT_CLASS,
  NODE_ROW_GAP_CLASS,
  NODE_ROW_HOVER_CLASS,
  NODE_ROW_LABEL_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import { llmConfigService } from '@/services/llm/LlmConfigService'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { UiSwitch } from '@/components/ui'
import { useCanvasStore } from '@/stores/canvasStore'
import type { LlmConfigState } from '@/core/llm/types'

const TextProcessingIcon = ICON_NODE_TEXT_PROCESSING
const logger = createLogger('features.canvas.text_processing')
const MEDIA_LIMITS: Record<RowMediaKind, number> = { image: 8, video: 1, audio: 1 }

type TextProcessingNodeProps = NodeProps & {
  id: string
  data: TextProcessingNodeData
  selected?: boolean
}

export const TextProcessingNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: TextProcessingNodeProps) => {
  const { t } = useTranslation()
  const [config, setConfig] = useState<LlmConfigState | null>(null)
  const [promptInvalid, setPromptInvalid] = useState(false)

  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode)
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false,
  )
  const hasNonDisplayConsumer = useCanvasStore((state) => (
    hasReachableNonDisplayConsumer(id, state.nodes, state.edges)
  ))

  const loadConfig = useCallback(async (): Promise<void> => {
    try {
      setConfig(await llmConfigService.getConfig())
    } catch (error) {
      logger.error('文本处理模型配置读取失败', error, {
        event: 'canvas.text_processing.config.failed',
        nodeId: id,
      })
    }
  }, [id])

  useEffect(() => {
    void loadConfig()
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, loadConfig)
    return () => window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, loadConfig)
  }, [loadConfig])

  const choices = useMemo(() => config ? listTextProcessingModels(config) : [], [config])
  const promptTemplates = useMemo(
    () => config?.textProcessingPromptTemplates ?? [],
    [config?.textProcessingPromptTemplates],
  )
  const selectedPromptTemplateId = useMemo(() => (
    data.systemPromptTemplateId
    && promptTemplates.some((template) => template.id === data.systemPromptTemplateId)
      ? data.systemPromptTemplateId
      : TEXT_PROCESSING_CUSTOM_TEMPLATE_ID
  ), [data.systemPromptTemplateId, promptTemplates])
  const selectedChoice = useMemo(
    () => resolveTextProcessingModel(choices, data.providerId, data.modelId),
    [choices, data.modelId, data.providerId],
  )
  const acceptedMediaKinds = useMemo(
    () => getTextProcessingMediaKinds(selectedChoice?.model ?? null),
    [selectedChoice],
  )

  useEffect(() => {
    if (!selectedChoice) return
    if (selectedChoice.model.providerId === data.providerId && selectedChoice.model.modelId === data.modelId) return
    updateNodeData(id, {
      providerId: selectedChoice.model.providerId,
      modelId: selectedChoice.model.modelId,
    }, { skipHistory: true })
  }, [data.modelId, data.providerId, id, selectedChoice, updateNodeData])

  const connectedParamIds = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => getConnectedParamIds(id, state.edges),
    areStringSetsEqual,
  )
  const injectedValues = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputValues(id, state.nodes, state.edges),
    areValueOverridesEqual,
  )
  const isPromptOverridden = connectedParamIds.has(PROMPT_PARAM_ID)
  const promptOverrideValue = isPromptOverridden && typeof injectedValues[PROMPT_PARAM_ID] === 'string'
    ? injectedValues[PROMPT_PARAM_ID] as string
    : null
  const incomingMedia = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMedia(id, state.nodes, state.edges)
      .filter((output) => acceptedMediaKinds.includes(output.kind as RowMediaKind)),
    areMediaOutputListsEqual,
  )
  const mediaInputs = useMemo(() => data.mediaInputs ?? {}, [data.mediaInputs])
  const promptState = useGenerationPromptDocument({
    nodeId: id,
    data,
    mediaInputs,
    incomingMedia,
    acceptedMediaKinds,
    isPromptOverridden,
    promptOverrideValue,
    invalid: promptInvalid,
    onValidContent: () => setPromptInvalid(false),
  })
  const systemPromptState = useTextProcessingSystemPrompt(id, data)
  const selectedPromptTemplate = useMemo(
    () => promptTemplates.find((template) => template.id === selectedPromptTemplateId) ?? null,
    [promptTemplates, selectedPromptTemplateId],
  )
  const isCustomPromptTemplate = selectedPromptTemplateId === TEXT_PROCESSING_CUSTOM_TEMPLATE_ID
  const effectiveSystemPromptDocument = useMemo(
    () => isCustomPromptTemplate
      ? systemPromptState.document
      : createPlainTextPromptDocument(selectedPromptTemplate?.systemPrompt ?? ''),
    [isCustomPromptTemplate, selectedPromptTemplate?.systemPrompt, systemPromptState.document],
  )

  useNodeHandlesSync(id, `prompt|${acceptedMediaKinds.join('|')}`)
  const { rootRef, inputRowsRef, minimumHeight } = useGenerationNodeMinimumHeight(
    isCustomPromptTemplate ? 190 : 320,
  )
  const resolvedWidth = Math.max(320, Math.round(width ?? 360))
  const resolvedHeight = Math.max(minimumHeight, Math.round(height ?? minimumHeight))
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.textProcessing, data)

  const handleModelSelect = useCallback((key: string): void => {
    const choice = choices.find((item) => item.key === key)
    if (!choice) return
    updateNodeData(id, {
      providerId: choice.model.providerId,
      modelId: choice.model.modelId,
    })
  }, [choices, id, updateNodeData])

  const handlePromptTemplateSelect = useCallback((templateId: string): void => {
    updateNodeData(id, { systemPromptTemplateId: templateId })
  }, [id, updateNodeData])

  const handlePromptTemplatesSave = useCallback(async (
    templates: LlmConfigState['textProcessingPromptTemplates'],
  ): Promise<boolean> => {
    if (!config) return false
    const nextConfig = { ...config, textProcessingPromptTemplates: templates }
    logger.info('文本处理提示词模板保存开始', {
      event: 'canvas.text_processing.prompt_templates.save_started',
      nodeId: id,
      templateCount: templates.length,
    })
    try {
      await llmConfigService.saveConfig(nextConfig)
      setConfig(nextConfig)
      logger.info('文本处理提示词模板保存完成', {
        event: 'canvas.text_processing.prompt_templates.save_completed',
        nodeId: id,
        templateCount: templates.length,
      })
      return true
    } catch (error) {
      logger.error('文本处理提示词模板保存失败', error, {
        event: 'canvas.text_processing.prompt_templates.save_failed',
        nodeId: id,
      })
      showAlertDialog({
        title: t('common:error'),
        message: t('node.textProcessing.templateSaveFailed'),
        type: 'error',
      })
      return false
    }
  }, [config, id, t])

  useTextProcessingExecution({
    nodeId: id,
    promptDocument: promptState.document,
    promptReferences: promptState.references,
    systemPromptDocument: effectiveSystemPromptDocument,
    media: promptState.mediaUrls,
    selectedChoice,
    setPromptInvalid,
    t,
  })

  return (
    <div
      ref={rootRef}
      className={`canvas-node-dynamic-min-height group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150 ${selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS}`}
      style={{ width: resolvedWidth, height: resolvedHeight, minHeight: minimumHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={`${NODE_HEADER_FLOATING_POSITION_CLASS} canvas-node-lod-detail`}
        icon={<TextProcessingIcon className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />
      <NodeLodPlaceholder title={resolvedTitle} icon={<TextProcessingIcon className="h-6 w-6" />} />

      <div className="canvas-node-lod-detail relative flex min-h-0 flex-1 flex-col gap-1.5">
        <GenerationPromptEditor
          nodeId={id}
          selected={Boolean(selected)}
          value={promptState.document}
          references={promptState.references}
          readOnly={isPromptOverridden}
          invalid={promptInvalid}
          label={t('node.textProcessing.userPromptLabel')}
          placeholder={promptInvalid
            ? t('node.textProcessing.promptRequired')
            : t('node.textProcessing.promptPlaceholder')}
          onChange={promptState.handleChange}
          onSubmit={() => void runCanvasNode(id).catch(() => undefined)}
          onEditEnd={promptState.onEditEnd}
          onSelectNode={setSelectedNode}
        />

        <div ref={inputRowsRef} className={`flex shrink-0 flex-col ${NODE_ROW_GAP_CLASS}`}>
          <TextProcessingModelRow
            choices={choices}
            selectedKey={selectedChoice
              ? createTextProcessingModelKey(selectedChoice.model.providerId, selectedChoice.model.modelId)
              : ''}
            onSelect={handleModelSelect}
          />
          {isCustomPromptTemplate ? (
            <TextProcessingSystemPromptEditor
              selected={Boolean(selected)}
              value={effectiveSystemPromptDocument}
              label={t('node.textProcessing.systemPromptLabel')}
              placeholder={t('node.textProcessing.systemPromptPlaceholder')}
              onChange={systemPromptState.handleChange}
              onSubmit={() => void runCanvasNode(id).catch(() => undefined)}
              onEditEnd={systemPromptState.onEditEnd}
              onSelectNode={() => setSelectedNode(id)}
            />
          ) : null}
          <TextProcessingPromptTemplateSelector
            label={t('node.textProcessing.promptTemplateLabel')}
            customLabel={t('node.textProcessing.customTemplate')}
            editLabel={t('node.textProcessing.editTemplates')}
            selectedTemplateId={selectedPromptTemplateId}
            templates={promptTemplates}
            onSelect={handlePromptTemplateSelect}
            onSaveTemplates={handlePromptTemplatesSave}
          />
          {acceptedMediaKinds.map((kind) => (
            <MediaInputRow
              key={kind}
              nodeId={id}
              mediaKind={kind}
              label={t(`node.mediaRow.${kind}`)}
              maxCount={MEDIA_LIMITS[kind]}
              inlineValue={mediaInputs[kind] ?? []}
              onInlineChange={(next) => promptState.handleMediaInputChange(kind, next)}
            />
          ))}
          {hasNonDisplayConsumer && (
            <div
              className={`${NODE_ROW_CLASS} ${NODE_ROW_HOVER_CLASS}`}
              title={t('node.textProcessing.fixedResultHint')}
            >
              <span className={NODE_ROW_LABEL_CLASS}>{t('node.textProcessing.fixedResultLabel')}</span>
              <div className={NODE_ROW_CONTROL_SLOT_CLASS}>
                <UiSwitch
                  checked={data.fixedResult !== false}
                  onCheckedChange={(fixedResult) => updateNodeData(id, { fixedResult })}
                  aria-label={t('node.textProcessing.fixedResultLabel')}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ background: getSocketColor('STRING'), right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
      <NodeResizeHandle minWidth={320} minHeight={minimumHeight} maxWidth={900} maxHeight={1000} />
    </div>
  )
})

TextProcessingNode.displayName = 'TextProcessingNode'
