import { useCallback, useEffect, useRef } from 'react'
import type { TFunction } from 'i18next'

import { llmCancelTask, llmChatStream } from '@/commands/llmRuntime'
import type { PromptReferenceItem } from '@/components/ui'
import { createLogger } from '@/core/logging'
import {
  createPlainTextPromptDocument,
  toModelPromptText,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'
import {
  buildTextProcessingRequest,
  createTextProcessingInputFingerprint,
  shouldReuseTextProcessingOutput,
  type TextProcessingMedia,
  type TextProcessingModelChoice,
} from '@/features/canvas/application/textProcessing'
import {
  registerCanvasNodeExecutor,
  type CanvasNodeExecutionContext,
  type CanvasNodeExecutionResult,
} from '@/features/canvas/application/canvasExecutionService'
import { collectInputValues } from '@/features/canvas/application/graphValueResolver'
import {
  CANVAS_NODE_TYPES,
  type TextAnnotationNodeData,
  type TextProcessingNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { getNodeIndexById } from '@/features/canvas/domain/connectionIndex'
import { PROMPT_PARAM_ID } from '@/features/canvas/domain/socketTypes'
import { UploadService } from '@/services/upload/UploadService'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useCanvasTextStreamStore } from '@/stores/canvasTextStreamStore'

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
  promptDocument: PromptDocumentV1
  promptReferences: PromptReferenceItem[]
  systemPromptDocument: PromptDocumentV1
  media: TextProcessingMedia
  selectedChoice: TextProcessingModelChoice | null
  setPromptInvalid: (invalid: boolean) => void
  t: TFunction
}

export function useTextProcessingExecution({
  nodeId,
  promptDocument,
  promptReferences,
  systemPromptDocument,
  media,
  selectedChoice,
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
    const canvas = useCanvasStore.getState()
    const latestInjectedValues = collectInputValues(nodeId, canvas.nodes, canvas.edges)
    const latestPromptOverride = latestInjectedValues[PROMPT_PARAM_ID]
    const runtimePromptDocument = typeof latestPromptOverride === 'string'
      ? createPlainTextPromptDocument(latestPromptOverride)
      : promptDocument
    const prompt = toModelPromptText(runtimePromptDocument, { references: promptReferences }).trim()
    const systemPrompt = toModelPromptText(systemPromptDocument).trim()
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

    setPromptInvalid(false)
    const fingerprint = createTextProcessingInputFingerprint({
      prompt,
      systemPrompt,
      providerId: selectedChoice.provider.providerId,
      modelId: selectedChoice.model.modelId,
      media,
    })
    const latestNode = canvas.nodes.find((node) => node.id === nodeId)
    const latestData = latestNode?.data as TextProcessingNodeData | undefined
    if (shouldReuseTextProcessingOutput({
      trigger: execution.trigger,
      fixedResult: latestData?.fixedResult,
      lastExecutionStatus: latestData?.lastExecutionStatus,
      lastOutputFingerprint: latestData?.lastOutputFingerprint,
      fingerprint,
    })) {
      return { status: 'reused' }
    }

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
      activeRequestIdsRef.current.delete(requestId)
    }
    if (failureHandled) throw new Error(failureMessage || '文本处理失败，已停止运行下游节点')
    return { status: 'completed', resultNodeIds: displayNodeIds }
  }, [media, nodeId, promptDocument, promptReferences, selectedChoice, setPromptInvalid, systemPromptDocument, t])

  useEffect(() => registerCanvasNodeExecutor(nodeId, {
    kind: 'text-processing',
    run,
  }), [nodeId, run])
}
