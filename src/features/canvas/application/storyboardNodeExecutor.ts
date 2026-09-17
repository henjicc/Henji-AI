import i18n from '@/i18n'
import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { GenerationService } from '@/core/services/GenerationService'
import { CANVAS_NODE_TYPES, EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT } from '../domain/canvasNodes'
import { EXPORT_RESULT_DISPLAY_NAME, resolveNodeDisplayName } from '../domain/nodeDisplay'
import { generateStoryboardImage } from './storyboardGeneration'
import { getStoryboardExecutionSignatureExtras, resolveStoryboardExecutionInput, STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS } from './storyboardExecutionInput'
import { commitCanvasGenerationOutputsInProject } from './generationOutputApplicationService'
import { STORYBOARD_GENERATION_RESUME_CONTEXT_FIELD } from './storyboardGenerationOutputService'
import { createCanvasGenerationTaskLifecycle } from '../generation/activeGenerationTasks'
import type { CanvasNodeExecutionContext, CanvasNodeExecutionResult, CanvasNodePreflightContext, CanvasRegisteredExecutor } from './canvasExecutionContracts'

export function createStoryboardNodeExecutor(id: string, store: typeof useCanvasStore,
  feedback: { onError: (message: string | null) => void; onMissingModel: () => void }): CanvasRegisteredExecutor {
  const t = i18n.t.bind(i18n)
  const { addNode, addEdge, findNodePosition, updateNodeData } = store.getState()
  const setNodeGenerationProgress = useCanvasGenerationProgressStore.getState().setProgress
  const handleGenerate = async (
    execution: CanvasNodeExecutionContext,
  ): Promise<CanvasNodeExecutionResult> => {
    const generationProjectId = execution.projectId
    if (!generationProjectId) throw new Error('当前没有可执行生成的画布项目')
    const target = execution.runtime
    if (!target) throw new Error('生成任务缺少工程运行实例')
    const runtime = resolveStoryboardExecutionInput(id, store)
    if (
      !runtime.model
      || !STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS.every((tag) => runtime.model?.meta.tags?.includes(tag))
    ) throw new Error('当前模型不支持分镜图生图')
    const prompt = runtime.prompt
    if (!prompt) {
      feedback.onError('请填写至少一个分镜内容描述')
      throw new Error('请填写至少一个分镜内容描述')
    }
    if (!runtime.providerConfigured) {
      feedback.onMissingModel()
      throw new Error(t('common:providerKeyRequired.message'))
    }

    const generationParams: DynamicValueMap = {
      ...runtime.paramValues,
      ...runtime.injectedValues,
      prompt,
      text: prompt,
    }
    const estimateParams: DynamicValueMap = {
      ...generationParams,
      ...(runtime.images.length > 0
        ? {
          images: runtime.images,
          uploadedFilePaths: runtime.images,
        }
        : {}),
    }
    const estimate = await GenerationService.getInstance().getProgressEstimate(
      runtime.modelId,
      estimateParams
    )
    await execution.assertCurrent()
    const generationDurationMs = estimate?.durationMs ?? 60_000
    const generationStartedAt = Date.now()
    const newNodePosition = findNodePosition(
      id,
      EXPORT_RESULT_NODE_DEFAULT_WIDTH,
      EXPORT_RESULT_NODE_LAYOUT_HEIGHT
    )
    const newNodeId = addNode(CANVAS_NODE_TYPES.exportImage, newNodePosition, {
      isGenerating: true,
      generationStartedAt,
      generationDurationMs,
      displayName: EXPORT_RESULT_DISPLAY_NAME.storyboardGenOutput,
      resultKind: 'storyboardGenOutput',
      generationSourceNodeId: id,
      generationInputSignature: execution.inputSignature,
      [STORYBOARD_GENERATION_RESUME_CONTEXT_FIELD]: runtime.resumeContext,
      prompt: '',
      modelId: runtime.modelId,
      params: { ...runtime.paramValues },
    })

    addEdge(id, newNodeId)
    await target.persist()
    feedback.onError(null)
    const taskLifecycle = createCanvasGenerationTaskLifecycle(
      target.isCurrent,
      async taskId => {
        updateNodeData(newNodeId, { serverTaskId: taskId, serverTaskModelId: runtime.modelId })
        await target.persist()
      },
    )

    try {
      const generated = await generateStoryboardImage({
        signal: execution.signal,
        modelId: runtime.modelId,
        params: generationParams,
        incomingImages: runtime.images,
        frameAspectRatioValue: runtime.frameAspectRatio,
        resumeContext: runtime.resumeContext,
        gridImageResolution: runtime.gridResolution,
        onProgress: (progress) => {
          setNodeGenerationProgress(newNodeId, progress)
        },
        onTaskId: taskLifecycle.onTaskId,
        assertCurrent: execution.assertCurrent,
      })

      const committed = await commitCanvasGenerationOutputsInProject(generationProjectId, {
        sourceNodeId: id,
        placeholderNodeId: newNodeId,
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
        contract: generated.contract,
        completionId: `storyboard-grid:${newNodeId}`,
        groupTitle: `${resolveNodeDisplayName(CANVAS_NODE_TYPES.storyboardGen, runtime.data)} · ${generated.contract.outputs.length}`,
        signal: execution.signal,
      }, target)
      return { status: committed.idempotent ? 'reused' : 'completed', resultNodeIds: committed.resultNodeIds }
    } catch (generationError) {
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationError:
          generationError instanceof Error ? generationError.message : '生成失败',
      })
      throw generationError
    } finally {
      taskLifecycle.release()
      await target.persist()
      setNodeGenerationProgress(newNodeId, null)
    }
  }

  const preflightBeforeDependencies = (execution: CanvasNodePreflightContext) => {
    execution.signal?.throwIfAborted()
    const runtime = resolveStoryboardExecutionInput(id, store)
    if (
      !runtime.model
      || !STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS.every((tag) => runtime.model?.meta.tags?.includes(tag))
    ) throw new Error('当前模型不支持分镜图生图')
    if (runtime.providerConfigured) return
    feedback.onMissingModel()
    throw new Error(t('common:providerKeyRequired.message'))
  }

  return {
    kind: 'storyboard-generation',
    dependency: { mode: 'auto', outputMode: 'result-nodes' },
    getInputSignatureExtras: getStoryboardExecutionSignatureExtras,
    preflightBeforeDependencies,
    run: handleGenerate,
  }

}
