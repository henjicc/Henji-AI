import i18n from '@/i18n'
import { GenerationService } from '@/core/services/GenerationService'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { collectInputMediaByKind } from './graphMediaResolver'
import { commitCanvasGenerationOutputsInProject } from './generationOutputApplicationService'
import { executeMultiAngleBatch } from './multiAngleBatchService'
import { CANVAS_IMAGE_CAPABILITY_IDS } from '../capabilities/types'
import { createMultiAngleCommitContract, normalizeMultiAngleConfig, resolveMultiAngleExecutionTarget } from '../capabilities/multiAnglePolicy'
import { CANVAS_NODE_TYPES, EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT } from '../domain/canvasNodes'
import { runCanvasGeneration, resumeCanvasGeneration } from '../generation/runGeneration'
import { ensureGenerationProviderConfigured } from '../nodes/shared/generationNodeGuards'
import type { CanvasNodeExecutionContext, CanvasNodeExecutionResult, CanvasRegisteredExecutor } from './canvasExecutionContracts'
import type { MultiAngleGenerationNodeData } from './specialGenerationNodeTypes'

function readSourceImages(nodeId: string, data: MultiAngleGenerationNodeData, store: typeof useCanvasStore): string[] {
  const canvas = store.getState()
  const incoming = collectInputMediaByKind(nodeId, canvas.nodes, canvas.edges, 'image')
    .map((item) => item.url)
  const sources = incoming.length > 0 ? incoming : data.mediaInputs?.image ?? []
  return sources.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function requireSingleSource(sources: readonly string[], errorMessage: string): string {
  if (sources.length !== 1) throw new Error(errorMessage)
  return sources[0]
}

function createPlaceholder(
  sourceNodeId: string,
  inputSignature: string,
  data: MultiAngleGenerationNodeData,
  displayName: string,
  store: typeof useCanvasStore,
): string {
  const canvas = store.getState()
  const config = normalizeMultiAngleConfig(data.multiAngleConfig)
  const executionTarget = resolveMultiAngleExecutionTarget(config.controlProfile)
  const previousId = data.multiAngleResultPlaceholderId?.trim()
  if (previousId && canvas.nodes.some((node) => node.id === previousId && node.type === CANVAS_NODE_TYPES.exportImage)) {
    canvas.updateNodeData(previousId, {
      isGenerating: true,
      generationStartedAt: Date.now(),
      generationError: null,
      generationSourceNodeId: sourceNodeId,
      generationInputSignature: inputSignature,
    })
    return previousId
  }
  const nodeId = canvas.addNode(
    CANVAS_NODE_TYPES.exportImage,
    canvas.findNodePosition(sourceNodeId, EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT),
    {
      isGenerating: true,
      generationStartedAt: Date.now(),
      displayName,
      resultKind: 'image',
      sourceCapabilityId: CANVAS_IMAGE_CAPABILITY_IDS.multiAngle,
      generationSourceNodeId: sourceNodeId,
      generationInputSignature: inputSignature,
      generationPrompt: '',
      generationModelId: executionTarget.modelId,
      generationMappedParams: { multiAngleConfig: config },
    },
  )
  canvas.addEdge(sourceNodeId, nodeId)
  canvas.updateNodeData(sourceNodeId, { multiAngleResultPlaceholderId: nodeId })
  return nodeId
}

export function createMultiAngleNodeExecutor(id: string, store: typeof useCanvasStore): CanvasRegisteredExecutor {
  const t = i18n.t.bind(i18n)
  const updateNodeData = store.getState().updateNodeData
  const prepareExecution = () => {
    const latest = store.getState().nodes.find((node) => node.id === id)
    if (!latest) throw new Error(t('node.multiAngleGeneration.errors.nodeMissing', { id }))
    const latestData = latest.data as MultiAngleGenerationNodeData
    const latestConfig = normalizeMultiAngleConfig(latestData.multiAngleConfig)
    const sourceImage = requireSingleSource(
      readSourceImages(id, latestData, store),
      t('node.multiAngleGeneration.errors.singleSource'),
    )
    ensureGenerationProviderConfigured(useSettingsStore.getState().providerKeyStatus.fal === true, {
      title: t('node.multiAngleGeneration.providerRequiredTitle'),
      message: t('node.multiAngleGeneration.providerRequiredMessage'),
      error: t('node.multiAngleGeneration.apiKeyRequired'),
    })
    return { latestData, latestConfig, sourceImage }
  }

  const handleGenerate = async (
    execution: CanvasNodeExecutionContext,
  ): Promise<CanvasNodeExecutionResult> => {
    const generationProjectId = execution.projectId
    if (!generationProjectId) throw new Error(t('node.multiAngleGeneration.errors.projectMissing'))
    const target = execution.runtime
    if (!target) throw new Error('生成任务缺少工程运行实例')
    const prepared = prepareExecution()
    await execution.assertCurrent()
    const placeholderNodeId = createPlaceholder(
      id,
      execution.inputSignature,
      prepared.latestData,
      t('node.multiAngleGeneration.resultTitle'),
      store,
    )
    await target.persist()

    try {
      const result = await executeMultiAngleBatch({
        config: prepared.latestConfig,
        sourceImage: prepared.sourceImage,
        previous: prepared.latestData.multiAngleBatch,
        signal: execution.signal,
        onSnapshot: (snapshot) => {
          updateNodeData(id, { multiAngleBatch: snapshot })
        },
        cancelTask: (requestId) => GenerationService.getInstance().cancelTask(requestId),
        execute: async (plan, context) => {
          await target.persist()
          const generated = context.resumeProviderRequestId
            ? await resumeCanvasGeneration({
                modelId: plan.modelId,
                mediaType: 'image',
                signal: context.signal,
                taskId: context.resumeProviderRequestId,
              })
            : await runCanvasGeneration({
                modelId: plan.modelId,
                mediaType: 'image',
                signal: context.signal,
                params: plan.params,
                upstream: { images: [prepared.sourceImage] },
                onTaskId: async taskId => { context.onProviderRequestId(taskId); await target.persist() },
                assertCurrent: execution.assertCurrent,
              })
          if (generated.outputs.length !== 1) {
            throw new Error(t('node.multiAngleGeneration.errors.singleOutput', {
              count: generated.outputs.length,
            }))
          }
          return {
            mediaUrl: generated.outputs[0],
            providerRequestId: context.resumeProviderRequestId,
          }
        },
      })
      if (!result.complete) {
        const error = result.errors.join('; ') || t('node.multiAngleGeneration.errors.batchIncomplete')
        updateNodeData(placeholderNodeId, {
          isGenerating: false,
          generationStartedAt: null,
          generationError: error,
        })
        throw new Error(error)
      }

      const committed = await commitCanvasGenerationOutputsInProject(generationProjectId, {
        signal: execution.signal,
        sourceNodeId: id,
        placeholderNodeId,
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
        contract: createMultiAngleCommitContract(result.completed),
        completionId: `multi-angle:${result.snapshot.batchId}`,
        groupTitle: t('node.multiAngleGeneration.groupTitle', { count: result.completed.length }),
      }, target)
      updateNodeData(id, {
        multiAngleBatch: null,
        multiAngleResultPlaceholderId: null,
      })
      return { status: committed.idempotent ? 'reused' : 'completed', resultNodeIds: committed.resultNodeIds }
    } catch (error) {
      updateNodeData(placeholderNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationError: error instanceof Error
          ? error.message
          : t('node.multiAngleGeneration.generationFailed'),
      })
      throw error
    } finally {
      await target.persist()
    }
  }

  return {
    kind: 'standard-generation',
    dependency: { mode: 'auto', outputMode: 'result-nodes' },
    preflightBeforeDependencies: () => ensureGenerationProviderConfigured(
      useSettingsStore.getState().providerKeyStatus.fal === true,
      {
        title: t('node.multiAngleGeneration.providerRequiredTitle'),
        message: t('node.multiAngleGeneration.providerRequiredMessage'),
        error: t('node.multiAngleGeneration.apiKeyRequired'),
      },
    ),
    run: handleGenerate,
  }

}
