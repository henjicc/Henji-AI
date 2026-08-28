import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Camera, Settings2 } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import { UiButton } from '@/components/ui'
import { GenerationService } from '@/core/services/GenerationService'
import {
  areMediaOutputListsEqual,
  collectInputMediaByKind,
} from '@/features/canvas/application/graphMediaResolver'
import { commitCanvasGenerationOutputs } from '@/features/canvas/application/generationOutputApplicationService'
import {
  executeMultiAngleBatch,
  type MultiAngleBatchSnapshotV1,
} from '@/features/canvas/application/multiAngleBatchService'
import { openCanvasSpecialEditor } from '@/features/canvas/application/specialEditorApplicationService'
import {
  registerCanvasNodeExecutor,
  type CanvasNodeExecutionResult,
} from '@/features/canvas/application/canvasExecutionService'
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
} from '@/features/canvas/capabilities/types'
import {
  createMultiAngleCommitContract,
  normalizeMultiAngleConfig,
  summarizeMultiAngleConfig,
  type MultiAngleConfigV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_DEFAULT_WIDTH,
  EXPORT_RESULT_NODE_LAYOUT_HEIGHT,
  type ImageEditNodeData,
} from '@/features/canvas/domain/canvasNodes'
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex'
import { getSocketColor } from '@/features/canvas/domain/socketTypes'
import { runCanvasGeneration, resumeCanvasGeneration } from '@/features/canvas/generation/runGeneration'
import { MediaInputRow } from '@/features/canvas/params/MediaInputRow'
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader'
import { NodeLodPlaceholder } from '@/features/canvas/ui/NodeLodPlaceholder'
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle'
import {
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { ensureGenerationProviderConfigured } from './shared/generationNodeGuards'

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

function requireSingleSource(sources: readonly string[]): string {
  if (sources.length !== 1) throw new Error('多角度生成必须且只能提供 1 张源图')
  return sources[0]
}

function createPlaceholder(sourceNodeId: string, data: MultiAngleGenerationNodeData): string {
  const canvas = useCanvasStore.getState()
  const previousId = data.multiAngleResultPlaceholderId?.trim()
  if (previousId && canvas.nodes.some((node) => node.id === previousId && node.type === CANVAS_NODE_TYPES.exportImage)) {
    canvas.updateNodeData(previousId, {
      isGenerating: true,
      generationStartedAt: Date.now(),
      generationError: null,
    })
    return previousId
  }
  const nodeId = canvas.addNode(
    CANVAS_NODE_TYPES.exportImage,
    canvas.findNodePosition(sourceNodeId, EXPORT_RESULT_NODE_DEFAULT_WIDTH, EXPORT_RESULT_NODE_LAYOUT_HEIGHT),
    {
      isGenerating: true,
      generationStartedAt: Date.now(),
      displayName: '多角度视图',
      resultKind: 'image',
      sourceCapabilityId: CANVAS_IMAGE_CAPABILITY_IDS.multiAngle,
      generationPrompt: '',
      generationModelId: data.modelId,
      generationMappedParams: { multiAngleConfig: data.multiAngleConfig },
    },
  )
  canvas.addEdge(sourceNodeId, nodeId)
  canvas.updateNodeData(sourceNodeId, { multiAngleResultPlaceholderId: nodeId })
  return nodeId
}

function batchStatus(snapshot: MultiAngleBatchSnapshotV1 | null | undefined): string {
  if (!snapshot) return '尚未生成'
  const success = snapshot.items.filter((item) => item.status === 'succeeded').length
  const failed = snapshot.items.filter((item) => item.status === 'failed').length
  if (failed > 0) return `${success}/${snapshot.items.length} 已完成 · ${failed} 个待重试`
  if (snapshot.items.some((item) => item.status === 'running')) return `${success}/${snapshot.items.length} 已完成`
  return `${success}/${snapshot.items.length} 已缓存`
}

export const MultiAngleGenerationNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: MultiAngleGenerationNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode)
  const projectId = useProjectStore((state) => state.currentProjectId)
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
  const summary = useMemo(() => summarizeMultiAngleConfig(config), [config])

  const prepareExecution = useCallback(() => {
    const latest = useCanvasStore.getState().nodes.find((node) => node.id === id)
    const latestData = (latest?.data ?? data) as MultiAngleGenerationNodeData
    const latestConfig = normalizeMultiAngleConfig(latestData.multiAngleConfig)
    const sourceImage = requireSingleSource(readSourceImages(id, latestData))
    ensureGenerationProviderConfigured(useSettingsStore.getState().providerKeyStatus.fal === true, {
      title: '需要配置 Fal',
      message: '多角度视图由 Fal 模型执行，请先配置 Fal API Key。',
      error: 'Fal API Key 未配置',
    })
    return { latestData, latestConfig, sourceImage }
  }, [data, id])

  const handleGenerate = useCallback(async (): Promise<CanvasNodeExecutionResult> => {
    const prepared = prepareExecution()
    const placeholderNodeId = createPlaceholder(id, prepared.latestData)
    const controller = new AbortController()
    activeControllerRef.current?.abort()
    activeControllerRef.current = controller

    try {
      const result = await executeMultiAngleBatch({
        config: prepared.latestConfig,
        sourceImage: prepared.sourceImage,
        previous: prepared.latestData.multiAngleBatch,
        signal: controller.signal,
        onSnapshot: (snapshot) => updateNodeData(id, { multiAngleBatch: snapshot }),
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
              })
          if (generated.outputs.length !== 1) {
            throw new Error(`多角度单视图预期 1 个输出，实际 ${generated.outputs.length}`)
          }
          return {
            mediaUrl: generated.outputs[0],
            providerRequestId: context.resumeProviderRequestId,
          }
        },
      })
      if (!result.complete) {
        const error = result.errors.join('；') || '多角度批次未完整完成'
        updateNodeData(placeholderNodeId, {
          isGenerating: false,
          generationStartedAt: null,
          generationError: error,
        })
        return { status: 'completed', resultNodeIds: [placeholderNodeId] }
      }

      const committed = await commitCanvasGenerationOutputs({
        sourceNodeId: id,
        placeholderNodeId,
        resultNodeType: CANVAS_NODE_TYPES.exportImage,
        contract: createMultiAngleCommitContract(result.completed),
        completionId: `multi-angle:${result.snapshot.batchId}`,
        groupTitle: `多角度视图 · ${result.completed.length}`,
      })
      updateNodeData(id, {
        multiAngleBatch: null,
        multiAngleResultPlaceholderId: null,
      })
      return { status: committed.idempotent ? 'reused' : 'completed', resultNodeIds: committed.resultNodeIds }
    } catch (error) {
      updateNodeData(placeholderNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationError: error instanceof Error ? error.message : '多角度生成失败',
      })
      return { status: 'completed', resultNodeIds: [placeholderNodeId] }
    } finally {
      if (activeControllerRef.current === controller) activeControllerRef.current = null
    }
  }, [id, prepareExecution, updateNodeData])

  useEffect(() => registerCanvasNodeExecutor(id, {
    kind: 'standard-generation',
    preflight: () => { prepareExecution() },
    run: handleGenerate,
  }), [handleGenerate, id, prepareExecution])
  useEffect(() => () => activeControllerRef.current?.abort(), [])

  const openEditor = (): void => {
    if (!projectId) return
    openCanvasSpecialEditor({
      projectId,
      nodeId: id,
      editorKey: 'multiAngle',
      initialState: {
        ...data,
        sourceImageUrl: sourceImages[0] ?? null,
        multiAngleConfig: config,
      },
    })
  }

  return (
    <div
      data-multi-angle-node-id={id}
      data-multi-angle-profile={config.controlProfile}
      className={`group relative flex flex-col gap-2 overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150 ${selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS}`}
      style={{
        width: `${Math.max(320, typeof width === 'number' ? width : 340)}px`,
        minWidth: '320px',
        maxWidth: '520px',
        height: `${Math.max(150, typeof height === 'number' ? height : 170)}px`,
        minHeight: '150px',
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Camera className="h-4 w-4" />}
        titleText={data.displayName ?? '多角度视图'}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />
      <NodeLodPlaceholder title={data.displayName ?? '多角度视图'} icon={<Camera className="h-6 w-6" />} />
      <div className="canvas-node-lod-detail flex min-h-0 flex-1 flex-col gap-2">
        <MediaInputRow
          nodeId={id}
          mediaKind="image"
          label="源图"
          maxCount={1}
          inlineValue={inlineSources}
          onInlineChange={(images) => updateNodeData(id, {
            mediaInputs: { ...(data.mediaInputs ?? {}), image: images },
          })}
        />
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-veil-subtle px-2.5 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-text-dark">{summary}</p>
            <p className="truncate text-2xs text-text-muted">{providerConfigured ? batchStatus(data.multiAngleBatch) : 'Fal 未配置'}</p>
          </div>
          <UiButton
            type="button"
            size="sm"
            variant="muted"
            className="nodrag shrink-0 gap-1.5"
            onClick={(event) => {
              event.stopPropagation()
              openEditor()
            }}
          >
            <Settings2 className="h-3.5 w-3.5" />
            调整角度
          </UiButton>
        </div>
        <p className="px-1 text-2xs text-text-muted">每个视图独立生成，并发 2；全部成功后一次性创建结果组。</p>
      </div>
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{
          background: getSocketColor('IMAGE'),
          right: 0,
          top: '50%',
          transform: 'translate(50%, -50%)',
        }}
      />
      <NodeResizeHandle minWidth={320} minHeight={150} maxWidth={520} maxHeight={360} />
    </div>
  )
})

MultiAngleGenerationNode.displayName = 'MultiAngleGenerationNode'
