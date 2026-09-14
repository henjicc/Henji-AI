import type { TFunction } from 'i18next'

import { createLogger } from '@/core/logging'
import { toModelPromptText } from '@/core/inputs/promptDocument'
import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import type { BuiltinModelType } from '@/core/types'
import { isCanvasProjectContextCurrent } from '@/features/canvas/application/canvasApplicationService'
import {
  commitCanvasGenerationOutputs,
  commitCanvasGenerationOutputsInProject,
  resolveGenerationOutputStrategy,
} from '@/features/canvas/application/generationOutputApplicationService'
import {
  type CanvasRegisteredExecutor,
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
import { createCanvasGenerationFailurePatch, createCanvasGenerationCancelledPatch } from '@/features/canvas/domain/generationFailure'
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
import { withCanvasProjectRuntime } from './canvasProjectRuntime'
import { createCanvasGenerationTaskRecord, canvasGenerationTaskControls } from './canvasGenerationTaskRecord'
import { retainCanvasTaskExecutor } from './canvasExecutionService'
import { confirmCanvasPersistence } from './canvasPersistenceService'
import type { CanvasNodeExecutionScheduler } from './canvasExecutionContracts'

import {
  DEFAULT_GENERATION_DURATION_MS,
  buildResultNodeTitle,
  ensureGenerationProviderConfigured,
  resolveGenerationPromptInput,
} from '../nodes/shared/generationNodeGuards'
import type {
  GenerationNodeRequestPreparation,
  GenerationNodeResultCommitContext,
  GenerationNodeResultCommitResult,
  GenerationNodeRuntimePreparationContext,
} from '../nodes/shared/generationNodeExecutionTypes'
import {
  runWithGenerationNodeResourceCleanup,
  type GenerationNodeResourceOwnership,
} from '../nodes/shared/generationNodeResourceOwnership'
import {
  createGenerationNodeRuntimeSignaturePayload,
  resolveGenerationNodeRuntime,
} from '../nodes/shared/generationNodeRuntime'

const logger = createLogger('features.canvas.generationExecutor')

export interface GenerationNodeExecutionOptions {
  nodeId: string
  requestId?: string
  signal?: AbortSignal
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
  supportsBackgroundCompletion?: boolean
  setPromptInvalid: (invalid: boolean) => void
  t: TFunction
}

/** UI 与后台调用共享的生成执行器；读取最新配置，不依赖 React 挂载。 */
export function createGenerationNodeExecutor(readOptions: (store?: typeof useCanvasStore) => GenerationNodeExecutionOptions) {
  const readRuntime = (store = useCanvasStore) => resolveGenerationNodeRuntime(readOptions(store), store)
  const readExecutionInputs = async (execution: CanvasNodeExecutionContext) => {
    const projectId = execution.projectId
    if (!projectId) throw new Error('当前没有可执行生成的画布项目')
    return withCanvasProjectRuntime(projectId, async target => {
      const current = readOptions(target.store)
      if (current.commitGenerationResult && !current.supportsBackgroundCompletion && !isCanvasProjectContextCurrent(projectId)) {
        throw new Error('此生成需要在原画布完成合成，请返回原项目')
      }
      return { current, runtime: resolveGenerationNodeRuntime(current, target.store) }
    })
  }

  const prepareRuntimeValues = async (
    values: DynamicValueMap,
    runtime: ReturnType<typeof resolveGenerationNodeRuntime>,
    current: GenerationNodeExecutionOptions,
  ): Promise<DynamicValueMap> => {
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
  }

  const prepareCapability = (
    currentParams: DynamicValueMap,
    userPrompt: string,
    runtime: ReturnType<typeof resolveGenerationNodeRuntime>,
    current: GenerationNodeExecutionOptions,
  ) => {
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
  }

  const prepareExecution = async (execution: CanvasNodeExecutionContext, inputs?: Awaited<ReturnType<typeof readExecutionInputs>>) => {
    const { current, runtime } = inputs ?? await readExecutionInputs(execution)
    const values = await prepareRuntimeValues({
      ...runtime.modelParamValues,
      ...runtime.injectedValues,
    }, runtime, current)
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
    const capabilityPreparation = prepareCapability(values, promptInput.prompt, runtime, current)
    ensureGenerationProviderConfigured(runtime.providerKeyConfigured, {
      title: current.t('common:providerKeyRequired.title'),
      message: current.t('common:providerKeyRequired.message'),
      error: current.t(current.apiKeyRequiredKey),
    })
    const prompt = capabilityPreparation?.prompt ?? promptInput.prompt
    const generationParams: DynamicValueMap = {
      ...(capabilityPreparation?.params ?? values), prompt, text: prompt,
      ...(typeof runtime.data.videoTrimStart === 'number' ? { uploadedVideoTrimStart: runtime.data.videoTrimStart } : {}),
      ...(typeof runtime.data.videoTrimEnd === 'number' ? { uploadedVideoTrimEnd: runtime.data.videoTrimEnd } : {}),
    }
    return { runtime, values, promptInput, capabilityPreparation, generationParams }
  }

  const preflightBeforeDependencies = (execution: CanvasNodePreflightContext) => {
    const current = readOptions(execution.store)
    if (
      execution.projectId
      && useProjectStore.getState().currentProjectId !== execution.projectId
      && (!execution.store || (current.commitGenerationResult && !current.supportsBackgroundCompletion))
    ) {
      throw new Error('画布项目已切换，本次生成已停止')
    }
    const runtime = readRuntime(execution.store)
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
  }

  const handleGenerate = async (
    execution: CanvasNodeExecutionContext,
    inputs: Awaited<ReturnType<typeof readExecutionInputs>>,
    preparedInput?: Awaited<ReturnType<typeof prepareExecution>>,
  ): Promise<CanvasNodeExecutionResult> => {
    const current = inputs.current
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
        const backgroundCompletion = !current.commitGenerationResult || current.supportsBackgroundCompletion === true
        const isProjectCurrent = (): boolean => isCanvasProjectContextCurrent(generationProjectId)
        const prepared = preparedInput ?? await prepareExecution(execution, inputs)
        const { runtime, promptInput, capabilityPreparation, generationParams } = prepared
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
        if (!backgroundCompletion && !isProjectCurrent()) throw new Error('画布项目已切换，本次生成已停止')
        await execution.assertCurrent()

        const generationStartedAt = Date.now()
        const createResultNode = (store: typeof useCanvasStore) => {
          const canvas = store.getState()
          const id = canvas.addNode(
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
          canvas.addEdge(current.nodeId, id)
          return id
        }
        let resultNodeId = ''
        let taskLifecycle: ReturnType<typeof createCanvasGenerationTaskLifecycle> | undefined
        const setProgress = useCanvasGenerationProgressStore.getState().setProgress
        try {
          resultNodeId = backgroundCompletion
            ? await withCanvasProjectRuntime(generationProjectId, async target => {
              await execution.assertCurrent(target.store)
              if (!target.isCurrent()) throw new Error('原项目实例已变化，请重新核对任务。')
              const id = createResultNode(target.store)
              resultNodeId = id
              await target.persist()
              return id
            })
            : createResultNode(useCanvasStore)
          taskLifecycle = createCanvasGenerationTaskLifecycle(
            backgroundCompletion ? () => true : isProjectCurrent,
            (taskId) => backgroundCompletion ? withCanvasProjectRuntime(generationProjectId, async target => {
              target.store.getState().updateNodeData(resultNodeId, { serverTaskId: taskId, serverTaskModelId: runtime.modelId })
              await target.persist()
            }) : useCanvasStore.getState().updateNodeData(resultNodeId, { serverTaskId: taskId, serverTaskModelId: runtime.modelId }),
          )

          // 原占位节点必须先落盘；供应商响应晚于页面切换时仍有稳定接收位置。
          if (!backgroundCompletion) await confirmCanvasPersistence(generationProjectId)
          const result = await runCanvasGeneration({
            modelId: runtime.modelId,
            requestId: current.requestId ?? requestPreparation?.requestId,
            signal: current.signal,
            mediaType: current.modelType,
            params: requestParams,
            upstream: requestInputs,
            onProgress: (progress) => {
              if (backgroundCompletion || isProjectCurrent()) setProgress(resultNodeId, progress)
            },
            onTaskId: taskLifecycle.onTaskId,
            assertCurrent: execution.assertCurrent,
          })
          ownership.generationResult = result
          current.signal?.throwIfAborted()
          if (!backgroundCompletion && !isProjectCurrent()) {
            await taskLifecycle.cancelLatest()
            throw new Error('画布项目已切换，本次生成结果已丢弃')
          }

          const completionId = `generation-output:${resultNodeId}`
          if (current.commitGenerationResult) {
            const committed = await current.commitGenerationResult({
              projectId: generationProjectId,
              signal: current.signal,
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
          const commit = backgroundCompletion
            ? (input: Parameters<typeof commitCanvasGenerationOutputs>[0]) => commitCanvasGenerationOutputsInProject(generationProjectId, input)
            : commitCanvasGenerationOutputs
          const committed = await commit({
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
          if (backgroundCompletion && resultNodeId) {
            await withCanvasProjectRuntime(generationProjectId, async target => {
              target.store.getState().updateNodeData(resultNodeId, current.signal?.aborted
                ? createCanvasGenerationCancelledPatch()
                : createCanvasGenerationFailurePatch(error, current.capability?.outputPolicy.resultKind))
              await target.persist()
            })
          } else if (resultNodeId && isProjectCurrent()) {
            useCanvasStore.getState().updateNodeData(resultNodeId, current.signal?.aborted
              ? createCanvasGenerationCancelledPatch()
              : createCanvasGenerationFailurePatch(error, current.capability?.outputPolicy.resultKind))
          }
          throw error
        } finally {
          taskLifecycle?.release()
          if (resultNodeId && (backgroundCompletion || isProjectCurrent())) setProgress(resultNodeId, null)
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
  }

  const handleTrackedGenerate = async (execution: CanvasNodeExecutionContext,
    schedule: CanvasNodeExecutionScheduler = operation => operation()): Promise<CanvasNodeExecutionResult> => {
    const inputs = await readExecutionInputs(execution)
    const current = inputs.current
    if (current.commitGenerationResult && !current.supportsBackgroundCompletion) {
      return schedule(() => handleGenerate(execution, inputs), current.signal)
    }
    const activeTask = current.requestId ? canvasGenerationTaskControls.get(current.requestId) : undefined
    if (activeTask) return schedule(async () => {
      await activeTask.start()
      return handleGenerate(execution, inputs)
    }, activeTask.controller.signal)
    const prepared = await prepareExecution(execution, inputs)
    const projectId = execution.projectId
    if (!projectId) throw new Error('当前没有可执行生成的画布项目')
    const taskId = crypto.randomUUID()
    const controller = new AbortController()
    const abort = () => controller.abort(current.signal?.reason)
    if (current.signal?.aborted) abort()
    current.signal?.addEventListener('abort', abort, { once: true })
    const extra = current.resultNodeExtraData
    let release: (() => void) | undefined
    try {
      const record = await createCanvasGenerationTaskRecord({ modelId: prepared.runtime.modelId, mediaType: current.modelType,
        prompt: prepared.promptInput.prompt, options: prepared.generationParams }, projectId, current.nodeId, taskId, controller)
      release = retainCanvasTaskExecutor(projectId, current.nodeId, registeredExecutor)
      return await record.run(() => schedule(async () => {
        await record.start()
        return handleGenerate(execution, { ...inputs, current: {
          ...current, requestId: taskId, signal: controller.signal,
          resultNodeExtraData: data => ({ ...(typeof extra === 'function' ? extra(data) : extra), generationTaskId: taskId }),
        } }, prepared)
      }, controller.signal))
    } finally {
      release?.()
      current.signal?.removeEventListener('abort', abort)
    }
  }

  const executor: CanvasRegisteredExecutor = {
    kind: 'standard-generation',
    dependency: { mode: 'auto', outputMode: 'result-nodes' },
    inputSignatureScope: 'runtime',
    getInputSignatureExtras: store => createGenerationNodeRuntimeSignaturePayload(readRuntime(store)),
    supportsBackgroundCompletion: store => {
      const options = readOptions(store)
      return !options.commitGenerationResult || options.supportsBackgroundCompletion === true
    },
    preflightBeforeDependencies,
    run: handleTrackedGenerate,
    runQueued: handleTrackedGenerate,
  }
  const registeredExecutor = { ...executor, prepare: prepareExecution }
  return registeredExecutor
}
