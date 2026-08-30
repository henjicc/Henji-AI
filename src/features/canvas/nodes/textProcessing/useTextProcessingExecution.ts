import { useCallback, useEffect, useRef } from 'react'
import type { TFunction } from 'i18next'
import type { TextProcessingPromptTemplate } from '@henjicc/ai-sdk'

import { llmCancelTask, llmChatStream } from '@/commands/llmRuntime'
import { createLogger } from '@/core/logging'
import {
  createPlainTextPromptDocument,
  readPromptDocument,
  toModelPromptText,
} from '@/core/inputs/promptDocument'
import {
  buildTextProcessingRequest,
  createTextProcessingInputFingerprint,
  getTextProcessingMediaKinds,
  resolveTextProcessingModel,
  resolveTextProcessingSystemPrompt,
  TEXT_PROCESSING_CUSTOM_TEMPLATE_ID,
  type TextProcessingMedia,
  type TextProcessingModelChoice,
} from '@/features/canvas/application/textProcessing'
import { resolveCanvasGenerationPrompt } from '@/features/canvas/application/generationPromptDocument'
import { collectInputMedia } from '@/features/canvas/application/graphMediaResolver'
import {
  registerCanvasNodeExecutor,
  type CanvasNodeExecutionContext,
  type CanvasNodeExecutionResult,
  type CanvasNodePreflightContext,
} from '@/features/canvas/application/canvasExecutionService'
import {
  collectInputValues,
  getConnectedParamIds,
} from '@/features/canvas/application/graphValueResolver'
import {
  CANVAS_NODE_TYPES,
  type TextAnnotationNodeData,
  type TextProcessingNodeData,
} from '@/features/canvas/domain/canvasNodes'
import {
  getNodeIndexById,
  isAuthoritativeIncomingSource,
} from '@/features/canvas/domain/connectionIndex'
import { PROMPT_PARAM_ID } from '@/features/canvas/domain/socketTypes'
import { UploadService } from '@/services/upload/UploadService'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore'
import { useProjectStore } from '@/stores/projectStore'

const logger = createLogger('features.canvas.text_processing')
const STREAM_PREVIEW_INTERVAL_MS = 200

function buildResultTitle(prompt: string, fallback: string): string {
  const normalized = prompt.trim()
  return normalized.length > 16 ? `${normalized.slice(0, 16)}…` : normalized || fallback
}

function createRequestId(): string {
  return `canvas-text-${crypto.randomUUID()}`
}

interface UseTextProcessingExecutionOptions {
  nodeId: string
  choices: TextProcessingModelChoice[]
  promptTemplates: TextProcessingPromptTemplate[]
  setPromptInvalid: (invalid: boolean) => void
  t: TFunction
}

export function useTextProcessingExecution({
  nodeId,
  choices,
  promptTemplates,
  setPromptInvalid,
  t,
}: UseTextProcessingExecutionOptions): void {
  const activeRequestIdsRef = useRef(new Set<string>())

  useEffect(() => () => {
    for (const requestId of activeRequestIdsRef.current) void llmCancelTask(requestId)
  }, [])

  const run = useCallback(async (
    execution: CanvasNodeExecutionContext,
  ): Promise<CanvasNodeExecutionResult> => {
    const isProjectCurrent = (): boolean => (
      !execution.projectId || useProjectStore.getState().currentProjectId === execution.projectId
    )
    if (!isProjectCurrent()) throw new Error('画布项目已切换，本次文本处理已停止')
    const canvas = useCanvasStore.getState()
    const latestNode = canvas.nodes.find((node) => node.id === nodeId)
    const latestData = latestNode?.data as TextProcessingNodeData | undefined
    if (!latestData) throw new Error(`画布执行节点不存在：${nodeId}`)
    const selectedChoice = resolveTextProcessingModel(
      choices,
      latestData.providerId,
      latestData.modelId,
    )
    const acceptedMediaKinds = getTextProcessingMediaKinds(selectedChoice?.model ?? null)
    const incomingMedia = collectInputMedia(nodeId, canvas.nodes, canvas.edges)
      .filter((output) => acceptedMediaKinds.includes(output.kind as typeof acceptedMediaKinds[number]))
    const promptCarrier = resolveCanvasGenerationPrompt({
      nodeId,
      document: latestData.promptDocument,
      legacyText: latestData.prompt ?? '',
      bindings: latestData.promptMediaBindings,
      mediaInputs: latestData.mediaInputs ?? {},
      incomingMedia,
      acceptedMediaKinds,
    })
    const latestInjectedValues = collectInputValues(nodeId, canvas.nodes, canvas.edges)
    const latestPromptOverride = latestInjectedValues[PROMPT_PARAM_ID]
    const runtimePromptDocument = getConnectedParamIds(nodeId, canvas.edges).has(PROMPT_PARAM_ID)
      && typeof latestPromptOverride === 'string'
      ? createPlainTextPromptDocument(latestPromptOverride)
      : promptCarrier.document
    const prompt = toModelPromptText(
      runtimePromptDocument,
      { references: promptCarrier.references },
    ).trim()
    const customSystemPrompt = toModelPromptText(readPromptDocument({
      document: latestData.systemPromptDocument,
      legacyText: latestData.systemPrompt ?? '',
    }, {
      carrierType: 'canvas-text-processing-system-prompt',
      carrierId: nodeId,
    }).document).trim()
    const systemPrompt = resolveTextProcessingSystemPrompt(
      customSystemPrompt,
      latestData.systemPromptTemplateId ?? TEXT_PROCESSING_CUSTOM_TEMPLATE_ID,
      promptTemplates,
    ).trim()
    const media: TextProcessingMedia = promptCarrier.mediaUrls
    if (!prompt) {
      setPromptInvalid(true)
      throw new Error(t('node.textProcessing.promptRequired'))
    }
    if (!selectedChoice) {
      showAlertDialog({
        title: t('common:error'),
        message: t('node.textProcessing.noModelConfigured'),
        type: 'warning',
        settingsTarget: { tab: 'models', sectionId: 'models-providers' },
      })
      throw new Error(t('node.textProcessing.noModelConfigured'))
    }
    await execution.assertCurrent()

    setPromptInvalid(false)
    const fingerprint = createTextProcessingInputFingerprint({
      prompt,
      systemPrompt,
      providerId: selectedChoice.provider.providerId,
      modelId: selectedChoice.model.modelId,
      media,
    })
    canvas.ensureTextDisplayOutput(nodeId, {
      displayName: buildResultTitle(prompt, t('node.textProcessing.resultTitle')),
      content: '',
    })
    const runtimeCanvas = useCanvasStore.getState()
    const runtimeNodeById = getNodeIndexById(runtimeCanvas.nodes)
    const displayNodeIds = runtimeCanvas.edges
      .filter((edge) => edge.source === nodeId && (edge.sourceHandle ?? 'source') === 'source')
      .map((edge) => runtimeNodeById.get(edge.target))
      .filter((node): node is NonNullable<typeof node> => (
        node?.type === CANVAS_NODE_TYPES.textAnnotation
        && isAuthoritativeIncomingSource(runtimeCanvas.edges, node.id, nodeId)
      ))
      .map((node) => node.id)
    const updateNodeData = useCanvasStore.getState().updateNodeData
    const requestId = createRequestId()
    activeRequestIdsRef.current.add(requestId)
    const startedAt = Date.now()
    for (const displayNodeId of displayNodeIds) {
      updateNodeData(displayNodeId, {
        isGenerating: true,
        generationStartedAt: startedAt,
        generationError: null,
      }, { skipHistory: true })
      useCanvasTextStreamStore.getState().setPreview(displayNodeId, {
        content: '',
        reasoning: '',
      }, execution.runId)
    }

    let output = ''
    let reasoning = ''
    let previewTimer: ReturnType<typeof setTimeout> | null = null
    let lastPreviewAt = 0
    let failureHandled = false
    let failureMessage = ''
    let completed = false
    const publishPreview = (): void => {
      previewTimer = null
      if (!isProjectCurrent()) return
      lastPreviewAt = Date.now()
      for (const displayNodeId of displayNodeIds) {
        useCanvasTextStreamStore.getState().setPreview(displayNodeId, {
          content: output,
          reasoning,
        }, execution.runId)
      }
    }
    const schedulePreview = (): void => {
      if (previewTimer !== null) return
      const delay = Math.max(0, STREAM_PREVIEW_INTERVAL_MS - (Date.now() - lastPreviewAt))
      if (delay === 0) publishPreview()
      else previewTimer = setTimeout(publishPreview, delay)
    }
    const commitDisplays = (resultPatch: Partial<TextAnnotationNodeData>): void => {
      if (previewTimer !== null) clearTimeout(previewTimer)
      if (!isProjectCurrent()) return
      publishPreview()
      for (const displayNodeId of displayNodeIds) {
        updateNodeData(displayNodeId, { content: output, ...resultPatch }, { skipHistory: true })
        useCanvasTextStreamStore.getState().setPreview(displayNodeId, null, execution.runId)
      }
    }
    const finishFailure = (message: string): void => {
      if (failureHandled) return
      failureHandled = true
      failureMessage = message
      if (!isProjectCurrent()) return
      updateNodeData(nodeId, { lastExecutionStatus: 'failed' }, { skipHistory: true })
      commitDisplays({
        isGenerating: false,
        generationStartedAt: null,
        generationError: message,
        syncedInputRevision: `${nodeId}:${latestData?.lastOutputRevision ?? 0}`,
      })
      logger.error('文本处理失败', new Error(message), {
        event: 'canvas.text_processing.failed',
        requestId,
        nodeId,
        providerId: selectedChoice.provider.providerId,
        modelId: selectedChoice.model.modelId,
      })
    }

    logger.info('文本处理开始', {
      event: 'canvas.text_processing.started',
      requestId,
      nodeId,
      providerId: selectedChoice.provider.providerId,
      modelId: selectedChoice.model.modelId,
      imageCount: media.image.length,
      videoCount: media.video.length,
      audioCount: media.audio.length,
    })

    const uploadService = UploadService.getInstance()
    const unsubscribeProject = useProjectStore.subscribe((state) => {
      if (!execution.projectId || state.currentProjectId === execution.projectId) return
      failureHandled = true
      failureMessage = '画布项目已切换，本次文本处理已停止'
      void llmCancelTask(requestId)
    })
    try {
      await llmChatStream(buildTextProcessingRequest({
        requestId,
        prompt,
        systemPrompt,
        choice: selectedChoice,
        media,
        uploadProvider: uploadService.getCurrentProvider(),
        uploadFallback: uploadService.isFallbackEnabled(),
      }), (event) => {
        if (failureHandled) return
        if (event.type === 'Token') {
          output += event.data
          schedulePreview()
        } else if (event.type === 'ReasoningToken') {
          reasoning += event.data
          schedulePreview()
        } else if (event.type === 'Error') {
          finishFailure(event.data)
        } else if (event.type === 'Done') {
          if (output.trim().length === 0) {
            finishFailure('文本处理没有返回可用文本')
            return
          }
          completed = true
          const outputRevision = (latestData?.lastOutputRevision ?? 0) + 1
          updateNodeData(nodeId, {
            lastOutput: output,
            lastOutputFingerprint: fingerprint,
            lastOutputRevision: outputRevision,
            lastExecutionStatus: 'success',
          }, { skipHistory: true })
          commitDisplays({
            isGenerating: false,
            generationStartedAt: null,
            generationDurationMs: Date.now() - startedAt,
            generationError: null,
            syncedInputRevision: `${nodeId}:${outputRevision}`,
          })
          logger.info('文本处理完成', {
            event: 'canvas.text_processing.completed',
            requestId,
            nodeId,
            outputChars: output.length,
          })
        }
      })
      if (!completed && !failureHandled) finishFailure('文本处理流提前结束，未收到完成事件')
    } catch (error) {
      finishFailure(error instanceof Error ? error.message : String(error))
    } finally {
      unsubscribeProject()
      activeRequestIdsRef.current.delete(requestId)
    }
    if (failureHandled) throw new Error(failureMessage || '文本处理失败，已停止运行下游节点')
    return { status: 'completed', resultNodeIds: displayNodeIds }
  }, [choices, nodeId, promptTemplates, setPromptInvalid, t])

  const getInputSignatureExtras = useCallback(() => {
    const latestData = useCanvasStore.getState().nodes.find((node) => node.id === nodeId)
      ?.data as TextProcessingNodeData | undefined
    const choice = latestData
      ? resolveTextProcessingModel(choices, latestData.providerId, latestData.modelId)
      : null
    const template = promptTemplates.find((item) => item.id === latestData?.systemPromptTemplateId)
    const uploadService = UploadService.getInstance()
    return {
      contractVersion: 2,
      upload: {
        provider: uploadService.getCurrentProvider(),
        fallback: uploadService.isFallbackEnabled(),
      },
      template: template ? { id: template.id, systemPrompt: template.systemPrompt } : null,
      model: choice ? {
        providerId: choice.provider.providerId,
        providerFamilyId: choice.provider.providerFamilyId,
        endpointProfile: choice.provider.endpointProfile,
        credentialId: choice.provider.credentialId,
        providerBaseUrl: choice.provider.baseUrl,
        providerAdapter: choice.provider.adapter,
        reasoning: choice.provider.reasoning,
        modelId: choice.model.modelId,
        modelBaseUrl: choice.model.baseUrl,
        modelAdapter: choice.model.adapter,
        capabilities: choice.model.capabilities,
      } : null,
    }
  }, [choices, nodeId, promptTemplates])

  const preflightBeforeDependencies = useCallback((execution: CanvasNodePreflightContext) => {
    if (
      execution.projectId
      && useProjectStore.getState().currentProjectId !== execution.projectId
    ) throw new Error('画布项目已切换，本次文本处理已停止')
    const latestData = useCanvasStore.getState().nodes.find((node) => node.id === nodeId)
      ?.data as TextProcessingNodeData | undefined
    const choice = latestData
      ? resolveTextProcessingModel(choices, latestData.providerId, latestData.modelId)
      : null
    if (choice) return
    showAlertDialog({
      title: t('common:error'),
      message: t('node.textProcessing.noModelConfigured'),
      type: 'warning',
      settingsTarget: { tab: 'models', sectionId: 'models-providers' },
    })
    throw new Error(t('node.textProcessing.noModelConfigured'))
  }, [choices, nodeId, t])

  useEffect(() => registerCanvasNodeExecutor(nodeId, {
    kind: 'text-processing',
    dependency: { mode: 'auto', outputMode: 'inline' },
    getInputSignatureExtras,
    isCachedOutputValid: (node) => (
      typeof (node.data as TextProcessingNodeData).lastOutput === 'string'
      && Boolean((node.data as TextProcessingNodeData).lastOutput?.trim())
    ),
    preflightBeforeDependencies,
    run,
  }), [getInputSignatureExtras, nodeId, preflightBeforeDependencies, run])
}
