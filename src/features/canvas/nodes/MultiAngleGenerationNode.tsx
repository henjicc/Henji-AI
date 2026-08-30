import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Camera } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

import { GenerationService } from '@/core/services/GenerationService'
import {
  areMediaOutputListsEqual,
  collectInputMediaByKind,
} from '@/features/canvas/application/graphMediaResolver'
import { commitCanvasGenerationOutputs } from '@/features/canvas/application/generationOutputApplicationService'
import { isCanvasProjectContextCurrent } from '@/features/canvas/application/canvasApplicationService'
import {
  executeMultiAngleBatch,
  type MultiAngleBatchSnapshotV1,
} from '@/features/canvas/application/multiAngleBatchService'
import {
  registerCanvasNodeExecutor,
  type CanvasNodeExecutionContext,
  type CanvasNodeExecutionResult,
} from '@/features/canvas/application/canvasExecutionService'
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
} from '@/features/canvas/capabilities/types'
import {
  createMultiAngleCommitContract,
  normalizeMultiAngleConfig,
  resolveMultiAngleExecutionTarget,
  type MultiAngleConfigV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type ImageEditNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex'
import { runCanvasGeneration, resumeCanvasGeneration } from '@/features/canvas/generation/runGeneration'
import { MediaInputRow } from '@/features/canvas/params/MediaInputRow'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { ensureGenerationProviderConfigured } from './shared/generationNodeGuards'
import { summarizeLocalizedMultiAngleConfig } from '@/features/canvas/ui/specialInterfaces/multiAngle/multiAngleLocalization'
import {
  MultiAngleWorkbench,
} from '@/features/canvas/ui/specialInterfaces/multiAngle/MultiAngleSpecialEditor'
import { buildMultiAngleEditorDraft } from '@/features/canvas/ui/specialInterfaces/multiAngle/multiAngleEditorState'
import {
  ToolWorkbenchNodeFrame,
  ToolWorkbenchSourcePreview,
} from './shared/ToolWorkbenchNodeFrame'

export interface MultiAngleGenerationNodeData extends ImageEditNodeData {
  capabilityId: 'image.multi-angle'
  multiAngleConfig: MultiAngleConfigV1
  multiAngleBatch?: MultiAngleBatchSnapshotV1 | null
  multiAngleResultPlaceholderId?: string | null
  sourceImageUrl?: string | null
}

type MultiAngleGenerationNodeProps = NodeProps & {
  id: string
  data: MultiAngleGenerationNodeData
  selected?: boolean
}

function readSourceImages(nodeId: string, data: MultiAngleGenerationNodeData): string[] {
  const canvas = useCanvasStore.getState()
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
): string {
  const canvas = useCanvasStore.getState()
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

function batchStatus(
  snapshot: MultiAngleBatchSnapshotV1 | null | undefined,
  t: TFunction,
): string {
  if (!snapshot) return t('node.multiAngleGeneration.status.notGenerated')
  const success = snapshot.items.filter((item) => item.status === 'succeeded').length
  const failed = snapshot.items.filter((item) => item.status === 'failed').length
  if (failed > 0) return t('node.multiAngleGeneration.status.failed', {
    success,
    total: snapshot.items.length,
    failed,
  })
  if (snapshot.items.some((item) => item.status === 'running')) {
    return t('node.multiAngleGeneration.status.running', { success, total: snapshot.items.length })
  }
  return t('node.multiAngleGeneration.status.cached', { success, total: snapshot.items.length })
}

export const MultiAngleGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: MultiAngleGenerationNodeProps) => {
  const { t } = useTranslation()
  const [workbenchReady, setWorkbenchReady] = useState(false)
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode)
  const providerConfigured = useSettingsStore((state) => state.providerKeyStatus.fal === true)
  const activeControllerRef = useRef<AbortController | null>(null)
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false,
  )
  const incomingSourceMedia = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMediaByKind(id, state.nodes, state.edges, 'image'),
    areMediaOutputListsEqual,
  )
  const inlineSources = data.mediaInputs?.image ?? []
  const sourceImages = incomingSourceMedia.length > 0
    ? incomingSourceMedia.map((item) => item.url)
    : inlineSources.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  const config = useMemo(() => normalizeMultiAngleConfig(data.multiAngleConfig), [data.multiAngleConfig])
  const summary = useMemo(() => summarizeLocalizedMultiAngleConfig(t, config), [config, t])

  useEffect(() => {
    if (!selected) {
      setWorkbenchReady(false)
      return undefined
    }
    // 先让 ReactFlow 提交节点骨架，再在下一帧初始化 Three/WebGL，避免工具条点击被 GPU 上下文创建卡住。
    const frame = window.requestAnimationFrame(() => setWorkbenchReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [selected])

  const prepareExecution = useCallback(() => {
    const latest = useCanvasStore.getState().nodes.find((node) => node.id === id)
    if (!latest) throw new Error(t('node.multiAngleGeneration.errors.nodeMissing', { id }))
    const latestData = latest.data as MultiAngleGenerationNodeData
    const latestConfig = normalizeMultiAngleConfig(latestData.multiAngleConfig)
    const sourceImage = requireSingleSource(
      readSourceImages(id, latestData),
      t('node.multiAngleGeneration.errors.singleSource'),
    )
    ensureGenerationProviderConfigured(useSettingsStore.getState().providerKeyStatus.fal === true, {
      title: t('node.multiAngleGeneration.providerRequiredTitle'),
      message: t('node.multiAngleGeneration.providerRequiredMessage'),
      error: t('node.multiAngleGeneration.apiKeyRequired'),
    })
    return { latestData, latestConfig, sourceImage }
  }, [id, t])

  const handleGenerate = useCallback(async (
    execution: CanvasNodeExecutionContext,
  ): Promise<CanvasNodeExecutionResult> => {
    const generationProjectId = execution.projectId
    if (!generationProjectId) throw new Error(t('node.multiAngleGeneration.errors.projectMissing'))
    const isGenerationProjectCurrent = (): boolean => (
      isCanvasProjectContextCurrent(generationProjectId)
    )
    const prepared = prepareExecution()
    await execution.assertCurrent()
    const placeholderNodeId = createPlaceholder(
      id,
      execution.inputSignature,
      prepared.latestData,
      t('node.multiAngleGeneration.resultTitle'),
    )
    const controller = new AbortController()
    activeControllerRef.current?.abort()
    activeControllerRef.current = controller

    try {
      const result = await executeMultiAngleBatch({
        config: prepared.latestConfig,
        sourceImage: prepared.sourceImage,
        previous: prepared.latestData.multiAngleBatch,
        signal: controller.signal,
        onSnapshot: (snapshot) => {
          if (isGenerationProjectCurrent()) updateNodeData(id, { multiAngleBatch: snapshot })
        },
        cancelTask: (requestId) => GenerationService.getInstance().cancelTask(requestId),
        execute: async (plan, context) => {
          const generated = context.resumeProviderRequestId
            ? await resumeCanvasGeneration({
                modelId: plan.modelId,
                mediaType: 'image',
                taskId: context.resumeProviderRequestId,
              })
            : await runCanvasGeneration({
                modelId: plan.modelId,
                mediaType: 'image',
                params: plan.params,
                upstream: { images: [prepared.sourceImage] },
                onTaskId: context.onProviderRequestId,
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
      if (!isGenerationProjectCurrent()) {
        controller.abort()
        throw new Error(t('node.multiAngleGeneration.errors.projectSwitched'))
      }
      if (!result.complete) {
        const error = result.errors.join('; ') || t('node.multiAngleGeneration.errors.batchIncomplete')
        updateNodeData(placeholderNodeId, {
          isGenerating: false,
          generationStartedAt: null,
          generationError: error,
        })
        throw new Error(error)
      }

      const committed = await commitCanvasGenerationOutputs({
        sourceNodeId: id,
        placeholderNodeId,
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
        contract: createMultiAngleCommitContract(result.completed),
        completionId: `multi-angle:${result.snapshot.batchId}`,
        groupTitle: t('node.multiAngleGeneration.groupTitle', { count: result.completed.length }),
      })
      updateNodeData(id, {
        multiAngleBatch: null,
        multiAngleResultPlaceholderId: null,
      })
      return { status: committed.idempotent ? 'reused' : 'completed', resultNodeIds: committed.resultNodeIds }
    } catch (error) {
      if (isGenerationProjectCurrent()) {
        updateNodeData(placeholderNodeId, {
          isGenerating: false,
          generationStartedAt: null,
          generationError: error instanceof Error
            ? error.message
            : t('node.multiAngleGeneration.generationFailed'),
        })
      }
      throw error
    } finally {
      if (activeControllerRef.current === controller) activeControllerRef.current = null
    }
  }, [id, prepareExecution, t, updateNodeData])

  useEffect(() => registerCanvasNodeExecutor(id, {
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
  }), [handleGenerate, id, t])
  useEffect(() => () => activeControllerRef.current?.abort(), [])

  return (
    <ToolWorkbenchNodeFrame
      nodeId={id}
      title={data.displayName ?? t('node.multiAngleGeneration.title')}
      icon={<Camera className="h-4 w-4" />}
      selected={selected}
      width={width}
      height={height}
      hasSourceConnections={hasSourceConnections}
      onSelect={() => setSelectedNode(id)}
      onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      rightSlot={(
        <span className="max-w-48 truncate text-2xs text-text-muted">
          {providerConfigured
            ? batchStatus(data.multiAngleBatch, t)
            : t('node.multiAngleGeneration.status.falNotConfigured')}
        </span>
      )}
      dataAttributes={{
        'data-multi-angle-node-id': id,
        'data-multi-angle-profile': config.controlProfile,
      }}
      defaultWidth={720}
      defaultHeight={400}
      minWidth={640}
      minHeight={340}
    >
      {selected && workbenchReady ? (
        <MultiAngleWorkbench
          config={config}
          sourceImage={sourceImages[0] ?? null}
          embedded
          sourceControl={(
            <MediaInputRow
              nodeId={id}
              mediaKind="image"
              label={t('node.multiAngleGeneration.sourceImage')}
              maxCount={1}
              inlineValue={inlineSources}
              onInlineChange={(images) => updateNodeData(id, {
                mediaInputs: { ...(data.mediaInputs ?? {}), image: images },
              })}
            />
          )}
          onConfigChange={(nextConfig) => updateNodeData(
            id,
            buildMultiAngleEditorDraft(data, nextConfig),
          )}
        />
      ) : (
        <ToolWorkbenchSourcePreview
          source={sourceImages[0] ?? null}
          alt={t('node.multiAngleEditor.sourceAlt')}
          icon={<Camera className="h-8 w-8" />}
          emptyText={t('node.multiAngleEditor.sourceRequired')}
          summary={summary}
        />
      )}
    </ToolWorkbenchNodeFrame>
  )
})

MultiAngleGenerationNode.displayName = 'MultiAngleGenerationNode'
