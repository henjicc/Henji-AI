import { useCallback, useEffect, useRef } from 'react'
import type { TFunction } from 'i18next'

import { createLogger } from '@/core/logging'
import { toModelPromptText } from '@/core/inputs/promptDocument'
import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import type { BuiltinModelType } from '@/core/types'
import { isCanvasProjectContextCurrent } from '@/features/canvas/application/canvasApplicationService'
import {
  commitCanvasGenerationOutputs,
  resolveGenerationOutputStrategy,
} from '@/features/canvas/application/generationOutputApplicationService'
import {
  registerCanvasNodeExecutor,
  type CanvasNodeExecutionContext,
  type CanvasNodeExecutionResult,
  type CanvasNodePreflightContext,
} from '@/features/canvas/application/canvasExecutionService'
import {
  prepareCanvasCapabilityGeneration,
  resolveCanvasImageCapabilityExpectedOutputCount,
  resolveCanvasCapabilityModelCandidates,
  validateCanvasCapabilityResultPatch,
} from '@/features/canvas/capabilities'
import type { CanvasImageCapabilityDefinition } from '@/features/canvas/capabilities/types'
import {
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type CanvasNodeData,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes'
import { createDefaultGenerationOutputItems } from '@/features/canvas/domain/generationOutputs'
import { createCanvasGenerationFailurePatch } from '@/features/canvas/domain/generationFailure'
import type { MediaKind } from '@/features/canvas/domain/nodePorts'
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes'
import {
  createCanvasGenerationTaskLifecycle,
} from '@/features/canvas/generation/activeGenerationTasks'
import { runCanvasGeneration } from '@/features/canvas/generation/runGeneration'
import { getPlatform } from '@/platform'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import {
  DEFAULT_GENERATION_DURATION_MS,
  buildResultNodeTitle,
  ensureGenerationProviderConfigured,
  resolveGenerationPromptInput,
} from './generationNodeGuards'
import type {
  GenerationNodeRequestPreparation,
  GenerationNodeResultCommitContext,
  GenerationNodeResultCommitResult,
  GenerationNodeRuntimePreparationContext,
} from './generationNodeExecutionTypes'
import {
  runWithGenerationNodeResourceCleanup,
  type GenerationNodeResourceOwnership,
} from './generationNodeResourceOwnership'
import {
  createGenerationNodeRuntimeSignaturePayload,
  resolveGenerationNodeRuntime,
} from './generationNodeRuntime'

const logger = createLogger('features.canvas.nodes.shared.useGenerationNodeExecution')

interface UseGenerationNodeExecutionOptions {
  nodeId: string
  modelType: BuiltinModelType
  resultNodeType: CanvasNodeType
  acceptedKinds: readonly MediaKind[]
  acceptedMediaKinds: readonly RowMediaKind[]
  capability: CanvasImageCapabilityDefinition | null
  showModelInput: boolean
  requirePrompt: boolean
  promptRequiredKey: string
  apiKeyRequiredKey: string
  resultTitleKey: string
  resultNodeExtraData?: DynamicValueMap | ((data: CanvasNodeData) => DynamicValueMap)
  prepareRuntimeParams?: (
    context: GenerationNodeRuntimePreparationContext,
  ) => Promise<DynamicValueMap> | DynamicValueMap
  prepareGenerationRequest?: (
    context: GenerationNodeRuntimePreparationContext,
  ) => Promise<GenerationNodeRequestPreparation> | GenerationNodeRequestPreparation
  commitGenerationResult?: (
    context: GenerationNodeResultCommitContext,
  ) => Promise<GenerationNodeResultCommitResult>
  setPromptInvalid: (invalid: boolean) => void
  t: TFunction
}

export function useGenerationNodeExecution(options: UseGenerationNodeExecutionOptions): void {
  // 节点 UI 会因进度、价格、连线和尺寸测量频繁重渲染。执行器必须保持稳定，
  // 同时在真正开始下一次运行时读取最新配置；否则一次普通重渲染会被协调器
  // 识别成“执行器已替换”，触发重试并遗留第一个占位结果节点。
  const optionsRef = useRef(options)
  optionsRef.current = options
  const nodeId = options.nodeId

  const readRuntime = useCallback(() => resolveGenerationNodeRuntime({
    nodeId: optionsRef.current.nodeId,
    modelType: optionsRef.current.modelType,
    acceptedKinds: optionsRef.current.acceptedKinds,
    acceptedMediaKinds: optionsRef.current.acceptedMediaKinds,
    capability: optionsRef.current.capability,
    showModelInput: optionsRef.current.showModelInput,
  }), [])

  const prepareRuntimeValues = useCallback(async (
    values: DynamicValueMap,
    runtime: ReturnType<typeof resolveGenerationNodeRuntime>,
  ): Promise<DynamicValueMap> => {
    const current = optionsRef.current
    if (!current.prepareRuntimeParams) return values
    return {
      ...values,
      ...await current.prepareRuntimeParams({
        data: runtime.data,
        images: runtime.images,
        videos: runtime.videos,
        audios: runtime.audios,
        params: values,
        modelId: runtime.modelId,
      }),
    }
  }, [])

  const prepareCapability = useCallback((
    currentParams: DynamicValueMap,
    userPrompt: string,
    runtime: ReturnType<typeof resolveGenerationNodeRuntime>,
  ) => {
    const current = optionsRef.current
    if (!current.capability) return null
    if (!runtime.model) throw new Error(current.t('modelPicker.noCompatibleModels'))
    const preparation = prepareCanvasCapabilityGeneration({
      capability: current.capability,
      model: runtime.model,
      currentParams,
      userPrompt,
      referenceImageCount: runtime.images.length,
    })
    if (!preparation.compatible) {
      throw new Error(preparation.reasons.join('；') || current.t('modelPicker.noCompatibleModels'))
    }
    return preparation
  }, [])

  const prepareExecution = useCallback(async (execution: CanvasNodeExecutionContext) => {
    const current = optionsRef.current
    if (
      execution.projectId
      && useProjectStore.getState().currentProjectId !== execution.projectId
    ) {
      throw new Error('画布项目已切换，本次生成已停止')
    }
    const runtime = readRuntime()
    const values = await prepareRuntimeValues({
      ...runtime.modelParamValues,
      ...runtime.injectedValues,
    }, runtime)
    const promptInput = resolveGenerationPromptInput(
      runtime.model,
      values,
      toModelPromptText(runtime.promptDocument, { references: runtime.promptReferences }),
      runtime.promptIsOverridden ? runtime.promptOverride : undefined,
    )
    if (current.requirePrompt && !promptInput.hasValidInput) {
      current.setPromptInvalid(true)
      throw new Error(current.t(current.promptRequiredKey))
    }
    current.setPromptInvalid(false)
    const capabilityPreparation = prepareCapability(values, promptInput.prompt, runtime)
    ensureGenerationProviderConfigured(runtime.providerKeyConfigured, {
      title: current.t('common:providerKeyRequired.title'),
      message: current.t('common:providerKeyRequired.message'),
      error: current.t(current.apiKeyRequiredKey),
    })
    return { runtime, values, promptInput, capabilityPreparation }
  }, [prepareCapability, prepareRuntimeValues, readRuntime])

  const preflightBeforeDependencies = useCallback((execution: CanvasNodePreflightContext) => {
    const current = optionsRef.current
    if (
      execution.projectId
      && useProjectStore.getState().currentProjectId !== execution.projectId
    ) {
      throw new Error('画布项目已切换，本次生成已停止')
    }
    const runtime = readRuntime()
    if (current.capability) {
      const compatibleModelIds = new Set(resolveCanvasCapabilityModelCandidates(
        registry.getModelsByType(current.modelType),
        current.capability.modelPolicy,
      ).candidates.map(({ model }) => model.meta.id))
      if (!runtime.model || !compatibleModelIds.has(runtime.modelId)) {
        throw new Error(current.t('modelPicker.noCompatibleModels'))
      }
    }
    ensureGenerationProviderConfigured(runtime.providerKeyConfigured, {
      title: current.t('common:providerKeyRequired.title'),
      message: current.t('common:providerKeyRequired.message'),
      error: current.t(current.apiKeyRequiredKey),
    })
  }, [readRuntime])

  const handleGenerate = useCallback(async (
    execution: CanvasNodeExecutionContext,
  ): Promise<CanvasNodeExecutionResult> => {
    const current = optionsRef.current
    const ownership: GenerationNodeResourceOwnership = {
      modelType: current.modelType,
      requestPreparation: null,
      generationResult: null,
    }

    return await runWithGenerationNodeResourceCleanup({
      ownership,
      operation: async () => {
        const generationProjectId = execution.projectId
        if (!generationProjectId) throw new Error('当前没有可执行生成的画布项目')
        const isProjectCurrent = (): boolean => isCanvasProjectContextCurrent(generationProjectId)
        const prepared = await prepareExecution(execution)
        const { runtime, promptInput, capabilityPreparation } = prepared
        const prompt = capabilityPreparation?.prompt ?? promptInput.prompt
        const generationParams: DynamicValueMap = {
          ...(capabilityPreparation?.params ?? prepared.values),
          prompt,
          text: prompt,
          ...(typeof runtime.data.videoTrimStart === 'number'
            ? { uploadedVideoTrimStart: runtime.data.videoTrimStart }
            : {}),
          ...(typeof runtime.data.videoTrimEnd === 'number'
            ? { uploadedVideoTrimEnd: runtime.data.videoTrimEnd }
            : {}),
        }
        ownership.requestPreparation = current.prepareGenerationRequest
          ? await current.prepareGenerationRequest({
              data: runtime.data,
              images: runtime.images,
              videos: runtime.videos,
              audios: runtime.audios,
              params: generationParams,
              modelId: runtime.modelId,
            })
          : null
        const requestPreparation = ownership.requestPreparation
        const requestParams = requestPreparation?.params ?? generationParams
        const requestInputs = requestPreparation?.inputs ?? {
          images: runtime.images,
          videos: runtime.videos,
          audios: runtime.audios,
        }
        const resultNodeData = requestPreparation?.resultNodeData ?? {}
        const resultNodeExtraData = typeof current.resultNodeExtraData === 'function'
          ? current.resultNodeExtraData(runtime.data)
          : current.resultNodeExtraData ?? {}
        const estimate = await GenerationService.getInstance().getProgressEstimate(runtime.modelId, {
          ...requestParams,
          ...(requestInputs.images.length > 0
            ? { images: requestInputs.images, uploadedFilePaths: requestInputs.images }
            : {}),
          ...(requestInputs.videos.length > 0
            ? { videos: requestInputs.videos, uploadedVideoFilePaths: requestInputs.videos }
            : {}),
        })
        if (!isProjectCurrent()) throw new Error('画布项目已切换，本次生成已停止')
        await execution.assertCurrent()

        const canvas = useCanvasStore.getState()
        const generationStartedAt = Date.now()
        const resultNodeId = canvas.addNode(
          current.resultNodeType,
          canvas.findNodePosition(
            current.nodeId,
            EXPORT_RESULT_NODE_DEFAULT_WIDTH,
            EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
          ),
          {
            isGenerating: true,
            generationStartedAt,
            generationDurationMs: estimate?.durationMs ?? DEFAULT_GENERATION_DURATION_MS,
            displayName: buildResultNodeTitle(promptInput.prompt, current.t(current.resultTitleKey)),
            generationSourceNodeId: current.nodeId,
            generationInputSignature: execution.inputSignature,
            generationProviderId: runtime.model?.meta.provider ?? null,
            generationInputImages: [...runtime.images],
            generationInputVideos: [...runtime.videos],
            generationInputAudios: [...runtime.audios],
            ...resultNodeExtraData,
            ...(capabilityPreparation?.resultNodeData ?? {}),
            ...resultNodeData,
          },
        )
        canvas.addEdge(current.nodeId, resultNodeId)
        const setProgress = useCanvasGenerationProgressStore.getState().setProgress
        const taskLifecycle = createCanvasGenerationTaskLifecycle(
          isProjectCurrent,
          (taskId) => useCanvasStore.getState().updateNodeData(resultNodeId, {
            serverTaskId: taskId,
            serverTaskModelId: runtime.modelId,
          }),
        )

        try {
          const result = await runCanvasGeneration({
            modelId: runtime.modelId,
            requestId: requestPreparation?.requestId,
            mediaType: current.modelType,
            params: requestParams,
            upstream: requestInputs,
            onProgress: (progress) => {
              if (isProjectCurrent()) setProgress(resultNodeId, progress)
            },
            onTaskId: taskLifecycle.onTaskId,
            assertCurrent: execution.assertCurrent,
          })
          ownership.generationResult = result
          if (!isProjectCurrent()) {
            await taskLifecycle.cancelLatest()
            throw new Error('画布项目已切换，本次生成结果已丢弃')
          }

          const completionId = `generation-output:${resultNodeId}`
          if (current.commitGenerationResult) {
            const committed = await current.commitGenerationResult({
              sourceNodeId: current.nodeId,
              placeholderNodeId: resultNodeId,
              resultNodeType: current.resultNodeType,
              completionId,
              modelId: runtime.modelId,
              providerId: runtime.model?.meta.provider ?? '',
              params: requestParams,
              inputs: requestInputs,
              result,
              resultNodeData,
            })
            return {
              status: committed.idempotent ? 'reused' : 'completed',
              resultNodeIds: committed.resultNodeIds,
            }
          }

          const outputResultKind = current.capability?.outputPolicy.resultKind
          const memberResultKind = outputResultKind === 'panorama' ? 'panorama' : current.modelType
          const strategy = resolveGenerationOutputStrategy({
            outputCount: result.outputs.length,
            resultKind: outputResultKind,
          })
          const batchResultKind = strategy === 'assetGroup'
            ? current.modelType === 'image' ? 'image-group' : 'media-group'
            : memberResultKind
          const committed = await commitCanvasGenerationOutputs({
            sourceNodeId: current.nodeId,
            placeholderNodeId: resultNodeId,
            resultNodeType: current.resultNodeType,
            contract: {
              version: 1,
              strategy,
              resultKind: outputResultKind ?? batchResultKind,
              expectedOutputCount: current.capability
                ? resolveCanvasImageCapabilityExpectedOutputCount(
                    current.capability.outputPolicy,
                    requestParams,
                  )
                : undefined,
              outputs: createDefaultGenerationOutputItems({
                sources: result.outputs,
                mediaType: current.modelType,
                resultKind: memberResultKind,
                semanticKind: outputResultKind === 'panorama' ? 'panorama' : 'generated-media',
              }),
            },
            completionId,
            validateResultPatch: current.capability
              ? (patch) => validateCanvasCapabilityResultPatch(
                  current.capability as CanvasImageCapabilityDefinition,
                  patch,
                  capabilityPreparation?.resultNodeData.panoramaProjectionMode,
                )
              : undefined,
          })
          return { status: 'completed', resultNodeIds: committed.resultNodeIds }
        } catch (error) {
          if (isProjectCurrent()) {
            useCanvasStore.getState().updateNodeData(resultNodeId, createCanvasGenerationFailurePatch(
              error, current.capability?.outputPolicy.resultKind,
            ))
          }
          throw error
        } finally {
          taskLifecycle.release()
          if (isProjectCurrent()) setProgress(resultNodeId, null)
        }
      },
      release: async (filePaths) => {
        await getPlatform().image.releaseManagedGenerationMedia(filePaths)
      },
      onReleaseError: (error, fileCount) => {
        logger.error('[CanvasGeneration] 临时媒体释放失败', {
          event: 'canvas.generation.resources.release_failed',
          error: { name: error instanceof Error ? error.name : 'UnknownError' },
          context: { nodeId: current.nodeId, fileCount },
        })
      },
    })
  }, [prepareExecution])

  useEffect(() => registerCanvasNodeExecutor(nodeId, {
    kind: 'standard-generation',
    dependency: { mode: 'auto', outputMode: 'result-nodes' },
    inputSignatureScope: 'runtime',
    getInputSignatureExtras: () => createGenerationNodeRuntimeSignaturePayload(readRuntime()),
    preflightBeforeDependencies,
    run: handleGenerate,
  }), [handleGenerate, nodeId, preflightBeforeDependencies, readRuntime])
}

export type {
  GenerationNodeRequestPreparation,
  GenerationNodeResultCommitContext,
  GenerationNodeResultCommitResult,
  GenerationNodeRuntimePreparationContext,
} from './generationNodeExecutionTypes'
