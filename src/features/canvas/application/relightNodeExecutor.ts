import i18n from '@/i18n'
import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { collectInputMediaByKind } from './graphMediaResolver'
import { commitCanvasGenerationOutputsInProject } from './generationOutputApplicationService'
import { normalizeRelightSettings, prepareRelightGenerationInput, prepareRelightRoute } from '../capabilities/relightPolicy'
import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities/types'
import { CANVAS_NODE_TYPES, EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT } from '../domain/canvasNodes'
import { createDefaultGenerationOutputItems } from '../domain/generationOutputs'
import { runCanvasGeneration } from '../generation/runGeneration'
import { createCanvasGenerationTaskLifecycle } from '../generation/activeGenerationTasks'
import { ensureGenerationProviderConfigured } from '../nodes/shared/generationNodeGuards'
import type { CanvasNodeExecutionContext, CanvasNodePreflightContext, CanvasNodeExecutionResult, CanvasRegisteredExecutor } from './canvasExecutionContracts'
import type { RelightGenerationNodeData } from './specialGenerationNodeTypes'

function resolveSourceImages(nodeId: string, data: RelightGenerationNodeData, store: typeof useCanvasStore): string[] {
  const state = store.getState()
  const incoming = collectInputMediaByKind(nodeId, state.nodes, state.edges, 'image')
    .map((item) => item.url)
  if (incoming.length > 0) return incoming
  return (data.mediaInputs?.image ?? []).filter((item) => typeof item === 'string' && item.trim())
}

export function createRelightNodeExecutor(id: string, store: typeof useCanvasStore): CanvasRegisteredExecutor {
  const t = i18n.t.bind(i18n)
  const { updateNodeData, addNode, addEdge, findNodePosition } = store.getState()
  const setProgress = useCanvasGenerationProgressStore.getState().setProgress
  const prepareExecution = () => {
    const latest = store.getState().nodes.find((node) => node.id === id)
    if (!latest) throw new Error(`画布执行节点不存在：${id}`)
    const latestData = latest.data as RelightGenerationNodeData
    const latestSettings = normalizeRelightSettings(latestData.relightSettings)
    const latestSources = resolveSourceImages(id, latestData, store)
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
  }

  const handleGenerate = async (
    execution: CanvasNodeExecutionContext,
  ): Promise<CanvasNodeExecutionResult> => {
    const generationProjectId = execution.projectId
    if (!generationProjectId) throw new Error('当前没有可执行生成的画布项目')
    const target = execution.runtime
    if (!target) throw new Error('生成任务缺少工程运行实例')
    const prepared = prepareExecution()
    const estimate = await GenerationService.getInstance().getProgressEstimate(
      prepared.route.model.meta.id,
      prepared.params,
    )
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
    await target.persist()
    const taskLifecycle = createCanvasGenerationTaskLifecycle(
      target.isCurrent,
      async (taskId) => { updateNodeData(newNodeId, {
        serverTaskId: taskId,
        serverTaskModelId: prepared.route.model.meta.id,
      }); await target.persist() },
    )

    try {
      const result = await runCanvasGeneration({
        modelId: prepared.route.model.meta.id,
        mediaType: 'image',
        signal: execution.signal,
        params: prepared.params,
        upstream: prepared.upstream,
        onProgress: (progress) => {
          setProgress(newNodeId, progress)
        },
        onTaskId: taskLifecycle.onTaskId,
        assertCurrent: execution.assertCurrent,
      })
      const committed = await commitCanvasGenerationOutputsInProject(generationProjectId, {
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
        signal: execution.signal,
      }, target)
      return { status: 'completed', resultNodeIds: committed.resultNodeIds }
    } catch (error) {
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationError: error instanceof Error ? error.message : t('ai.error'),
      })
      throw error
    } finally {
      taskLifecycle.release()
      await target.persist()
      setProgress(newNodeId, null)
    }
  }

  const preflightBeforeDependencies = (execution: CanvasNodePreflightContext) => {
    execution.signal?.throwIfAborted()
    const latest = store.getState().nodes.find((node) => node.id === id)
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
  }

  return {
    kind: 'standard-generation',
    dependency: { mode: 'auto', outputMode: 'result-nodes' },
    preflightBeforeDependencies,
    run: handleGenerate,
  }

}
