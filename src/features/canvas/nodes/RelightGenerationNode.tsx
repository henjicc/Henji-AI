import { memo, useCallback, useEffect, useMemo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { SunMedium } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import { getI18nText } from '@/core/types'
import {
  areMediaOutputListsEqual,
  collectInputMediaByKind,
} from '@/features/canvas/application/graphMediaResolver'
import {
  commitCanvasGenerationOutputs,
} from '@/features/canvas/application/generationOutputApplicationService'
import {
  registerCanvasNodeExecutor,
  type CanvasNodeExecutionContext,
  type CanvasNodeExecutionResult,
  type CanvasNodePreflightContext,
} from '@/features/canvas/application/canvasExecutionService'
import { isCanvasProjectContextCurrent } from '@/features/canvas/application/canvasApplicationService'
import {
  DEFAULT_RELIGHT_SETTINGS,
  normalizeRelightSettings,
  prepareRelightGenerationInput,
  prepareRelightRoute,
  summarizeRelightSettings,
  type RelightSettingsV1,
} from '@/features/canvas/capabilities/relightPolicy'
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
} from '@/features/canvas/capabilities/types'
import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type ImageEditNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex'
import { createDefaultGenerationOutputItems } from '@/features/canvas/domain/generationOutputs'
import { MediaInputRow } from '@/features/canvas/params/MediaInputRow'
import { runCanvasGeneration } from '@/features/canvas/generation/runGeneration'
import { createCanvasGenerationTaskLifecycle } from '@/features/canvas/generation/activeGenerationTasks'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { ensureGenerationProviderConfigured } from './shared/generationNodeGuards'
import {
  ToolWorkbenchNodeFrame,
  ToolWorkbenchSourcePreview,
} from './shared/ToolWorkbenchNodeFrame'
import {
  RelightWorkbench,
} from '@/features/canvas/ui/specialInterfaces/RelightSpecialEditor'
import { buildRelightEditorDraft } from '@/features/canvas/ui/specialInterfaces/relightEditorDraft'

export interface RelightGenerationNodeData extends ImageEditNodeData {
  capabilityId: 'image.relight'
  relightSettings: RelightSettingsV1
  promptTemplateVersion: string
  lightingReferenceImages: string[]
  relightRouteReasons?: string[]
  sourceImageUrl?: string | null
}

type RelightGenerationNodeProps = NodeProps & {
  id: string
  data: RelightGenerationNodeData
  selected?: boolean
}

function readSettings(data: RelightGenerationNodeData): RelightSettingsV1 {
  try {
    return normalizeRelightSettings(data.relightSettings)
  } catch {
    return normalizeRelightSettings(DEFAULT_RELIGHT_SETTINGS)
  }
}

function resolveSourceImages(nodeId: string, data: RelightGenerationNodeData): string[] {
  const state = useCanvasStore.getState()
  const incoming = collectInputMediaByKind(nodeId, state.nodes, state.edges, 'image')
    .map((item) => item.url)
  if (incoming.length > 0) return incoming
  return (data.mediaInputs?.image ?? []).filter((item) => typeof item === 'string' && item.trim())
}

export const RelightGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: RelightGenerationNodeProps) => {
  const { t } = useTranslation()
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode)
  const addNode = useCanvasStore((state) => state.addNode)
  const addEdge = useCanvasStore((state) => state.addEdge)
  const findNodePosition = useCanvasStore((state) => state.findNodePosition)
  const providerKeyStatus = useSettingsStore((state) => state.providerKeyStatus)
  const setProgress = useCanvasGenerationProgressStore((state) => state.setProgress)
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false,
  )
  const incomingSourceMedia = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMediaByKind(id, state.nodes, state.edges, 'image'),
    areMediaOutputListsEqual,
  )
  const settings = useMemo(() => readSettings(data), [data])
  const route = useMemo(() => prepareRelightRoute(
    settings,
    registry.getModelsByType('image'),
    data.params,
  ), [data.params, settings])
  const sourceInline = data.mediaInputs?.image ?? []
  const sourceImages = incomingSourceMedia.length > 0
    ? incomingSourceMedia.map((item) => item.url)
    : sourceInline.filter((item) => typeof item === 'string' && item.trim())
  const providerConfigured = route.model
    ? providerKeyStatus[route.model.meta.provider] === true
    : false
  const summary = useMemo(() => {
    try {
      return summarizeRelightSettings(settings)
    } catch {
      return '设置需要迁移'
    }
  }, [settings])

  const prepareExecution = useCallback(() => {
    const latest = useCanvasStore.getState().nodes.find((node) => node.id === id)
    if (!latest) throw new Error(`画布执行节点不存在：${id}`)
    const latestData = latest.data as RelightGenerationNodeData
    const latestSettings = normalizeRelightSettings(latestData.relightSettings)
    const latestSources = resolveSourceImages(id, latestData)
    const generationInput = prepareRelightGenerationInput(
      latestSettings,
      registry.getModelsByType('image'),
      latestSources,
      latestData.params,
    )
    const latestProviderConfigured = useSettingsStore.getState()
      .providerKeyStatus[generationInput.route.model.meta.provider] === true
    ensureGenerationProviderConfigured(latestProviderConfigured, {
      title: t('common:providerKeyRequired.title'),
      message: t('common:providerKeyRequired.message'),
      error: t('node.relightGeneration.apiKeyRequired'),
    })
    return {
      data: latestData,
      settings: latestSettings,
      ...generationInput,
    }
  }, [id, t])

  const handleGenerate = useCallback(async (
    execution: CanvasNodeExecutionContext,
  ): Promise<CanvasNodeExecutionResult> => {
    const generationProjectId = execution.projectId
    if (!generationProjectId) throw new Error('当前没有可执行生成的画布项目')
    const isGenerationProjectCurrent = (): boolean => (
      isCanvasProjectContextCurrent(generationProjectId)
    )
    const prepared = prepareExecution()
    const estimate = await GenerationService.getInstance().getProgressEstimate(
      prepared.route.model.meta.id,
      prepared.params,
    )
    if (!isGenerationProjectCurrent()) throw new Error('画布项目已切换，本次生成已停止')
    await execution.assertCurrent()
    const newNodeId = addNode(
      CANVAS_NODE_TYPES.exportImage,
      findNodePosition(id, EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT),
      {
        isGenerating: true,
        generationStartedAt: Date.now(),
        generationDurationMs: estimate?.durationMs,
        displayName: t('node.relightGeneration.resultTitle'),
        resultKind: 'image',
        sourceCapabilityId: CANVAS_IMAGE_CAPABILITY_IDS.relight,
        generationSourceNodeId: id,
        generationInputSignature: execution.inputSignature,
        sourceCapabilityTemplateVersion: prepared.route.templateVersion,
        generationPrompt: prepared.route.prompt,
        generationModelId: prepared.route.model.meta.id,
        generationCanonicalModelId: prepared.route.model.meta.canonicalModelId,
        generationMappedParams: prepared.route.params,
      },
    )
    addEdge(id, newNodeId)
    const taskLifecycle = createCanvasGenerationTaskLifecycle(
      isGenerationProjectCurrent,
      (taskId) => updateNodeData(newNodeId, {
        serverTaskId: taskId,
        serverTaskModelId: prepared.route.model.meta.id,
      }),
    )

    try {
      const result = await runCanvasGeneration({
        modelId: prepared.route.model.meta.id,
        mediaType: 'image',
        params: prepared.params,
        upstream: prepared.upstream,
        onProgress: (progress) => {
          if (isGenerationProjectCurrent()) setProgress(newNodeId, progress)
        },
        onTaskId: taskLifecycle.onTaskId,
        assertCurrent: execution.assertCurrent,
      })
      if (!isGenerationProjectCurrent()) {
        await taskLifecycle.cancelLatest()
        throw new Error('画布项目已切换，本次生成结果已丢弃')
      }
      const committed = await commitCanvasGenerationOutputs({
        sourceNodeId: id,
        placeholderNodeId: newNodeId,
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
        contract: {
          version: 1,
          strategy: 'single',
          resultKind: 'image',
          expectedOutputCount: 1,
          outputs: createDefaultGenerationOutputItems({
            sources: result.outputs,
            mediaType: 'image',
            resultKind: 'image',
            semanticKind: 'generated-media',
          }),
        },
        completionId: `generation-output:${newNodeId}`,
      })
      return { status: 'completed', resultNodeIds: committed.resultNodeIds }
    } catch (error) {
      if (isGenerationProjectCurrent()) {
        updateNodeData(newNodeId, {
          isGenerating: false,
          generationStartedAt: null,
          generationError: error instanceof Error ? error.message : t('ai.error'),
          serverTaskId: null,
          serverTaskModelId: null,
        })
      }
      throw error
    } finally {
      taskLifecycle.release()
      if (isGenerationProjectCurrent()) setProgress(newNodeId, null)
    }
  }, [addEdge, addNode, findNodePosition, id, prepareExecution, setProgress, t, updateNodeData])

  const preflightBeforeDependencies = useCallback((execution: CanvasNodePreflightContext) => {
    if (execution.projectId && !isCanvasProjectContextCurrent(execution.projectId)) {
      throw new Error('画布项目已切换，本次生成已停止')
    }
    const latest = useCanvasStore.getState().nodes.find((node) => node.id === id)
    if (!latest) throw new Error(`画布执行节点不存在：${id}`)
    const latestData = latest.data as RelightGenerationNodeData
    const staticRoute = prepareRelightRoute(
      normalizeRelightSettings(latestData.relightSettings),
      registry.getModelsByType('image'),
      latestData.params,
    )
    if (!staticRoute.model) {
      throw new Error(staticRoute.reasons.join('；') || '当前没有可用的重新打光模型')
    }
    ensureGenerationProviderConfigured(
      useSettingsStore.getState().providerKeyStatus[staticRoute.model.meta.provider] === true,
      {
        title: t('common:providerKeyRequired.title'),
        message: t('common:providerKeyRequired.message'),
        error: t('node.relightGeneration.apiKeyRequired'),
      },
    )
  }, [id, t])

  useEffect(() => registerCanvasNodeExecutor(id, {
    kind: 'standard-generation',
    dependency: { mode: 'auto', outputMode: 'result-nodes' },
    preflightBeforeDependencies,
    run: handleGenerate,
  }), [handleGenerate, id, preflightBeforeDependencies])

  const statusText = !route.model
    ? route.reasons[0] ?? '模型不可用'
    : providerConfigured
    ? `${getI18nText(route.model.meta.name, 'zh-CN')} · 已就绪`
      : `${getI18nText(route.model.meta.name, 'zh-CN')} · 未配置`

  return (
    <ToolWorkbenchNodeFrame
      nodeId={id}
      title={data.displayName ?? t('node.menu.relightGeneration')}
      icon={<SunMedium className="h-4 w-4" />}
      selected={selected}
      width={width}
      height={height}
      hasSourceConnections={hasSourceConnections}
      onSelect={() => setSelectedNode(id)}
      onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      rightSlot={<span className="max-w-48 truncate text-2xs text-text-muted">{statusText}</span>}
      dataAttributes={{
        'data-relight-node-id': id,
        'data-relight-mode': settings.lightingMode,
      }}
    >
      {selected ? (
        <RelightWorkbench
          settings={settings}
          sourceImage={sourceImages[0] ?? null}
          embedded
          sourceControl={(
            <MediaInputRow
              nodeId={id}
              mediaKind="image"
              label={t('node.relightGeneration.sourceImage')}
              maxCount={1}
              inlineValue={sourceInline}
              onInlineChange={(images) => updateNodeData(id, {
                mediaInputs: { ...(data.mediaInputs ?? {}), image: images },
              })}
            />
          )}
          onSettingsChange={(nextSettings) => updateNodeData(
            id,
            buildRelightEditorDraft(data, nextSettings),
          )}
        />
      ) : (
        <ToolWorkbenchSourcePreview
          source={sourceImages[0] ?? null}
          alt={t('node.relightGeneration.sourceAlt')}
          icon={<SunMedium className="h-8 w-8" />}
          emptyText={t('node.relightGeneration.sourceRequired')}
          summary={`${summary} · ${statusText}`}
        />
      )}
    </ToolWorkbenchNodeFrame>
  )
})

RelightGenerationNode.displayName = 'RelightGenerationNode'
