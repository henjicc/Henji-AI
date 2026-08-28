import { memo, useCallback, useEffect, useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Settings2, SunMedium } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import { UiButton } from '@/components/ui'
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
  openCanvasSpecialEditor,
} from '@/features/canvas/application/specialEditorApplicationService'
import {
  registerCanvasNodeExecutor,
  type CanvasNodeExecutionResult,
} from '@/features/canvas/application/canvasExecutionService'
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
import { getSocketColor } from '@/features/canvas/domain/socketTypes'
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
import { runCanvasGeneration } from '@/features/canvas/generation/runGeneration'
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { ensureGenerationProviderConfigured } from './shared/generationNodeGuards'

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
  const projectId = useProjectStore((state) => state.currentProjectId)
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
    const latestData = (latest?.data ?? data) as RelightGenerationNodeData
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
  }, [data, id, t])

  const handleGenerate = useCallback(async (): Promise<CanvasNodeExecutionResult> => {
    const prepared = prepareExecution()
    const estimate = await GenerationService.getInstance().getProgressEstimate(
      prepared.route.model.meta.id,
      prepared.params,
    )
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
        sourceCapabilityTemplateVersion: prepared.route.templateVersion,
        generationPrompt: prepared.route.prompt,
        generationModelId: prepared.route.model.meta.id,
        generationCanonicalModelId: prepared.route.model.meta.canonicalModelId,
        generationMappedParams: prepared.route.params,
      },
    )
    addEdge(id, newNodeId)

    try {
      const result = await runCanvasGeneration({
        modelId: prepared.route.model.meta.id,
        mediaType: 'image',
        params: prepared.params,
        upstream: prepared.upstream,
        onProgress: (progress) => setProgress(newNodeId, progress),
        onTaskId: (taskId) => updateNodeData(newNodeId, {
          serverTaskId: taskId,
          serverTaskModelId: prepared.route.model.meta.id,
        }),
      })
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
      updateNodeData(newNodeId, {
        isGenerating: false,
        generationStartedAt: null,
        generationError: error instanceof Error ? error.message : t('ai.error'),
        serverTaskId: null,
        serverTaskModelId: null,
      })
      return { status: 'completed', resultNodeIds: [newNodeId] }
    } finally {
      setProgress(newNodeId, null)
    }
  }, [addEdge, addNode, findNodePosition, id, prepareExecution, setProgress, t, updateNodeData])

  useEffect(() => registerCanvasNodeExecutor(id, {
    kind: 'standard-generation',
    preflight: () => { prepareExecution() },
    run: handleGenerate,
  }), [handleGenerate, id, prepareExecution])

  const openEditor = (): void => {
    if (!projectId) return
    openCanvasSpecialEditor({
      projectId,
      nodeId: id,
      editorKey: 'relight',
      initialState: {
        ...data,
        sourceImageUrl: sourceImages[0] ?? null,
        relightSettings: settings,
      },
    })
  }

  const statusText = !route.model
    ? route.reasons[0] ?? '模型不可用'
    : providerConfigured
    ? `${getI18nText(route.model.meta.name, 'zh-CN')} · 已就绪`
      : `${getI18nText(route.model.meta.name, 'zh-CN')} · 未配置`

  return (
    <div
      data-relight-node-id={id}
      data-relight-mode={settings.lightingMode}
      className={`group relative flex flex-col gap-2 overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150 ${
        selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS
      }`}
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
        icon={<SunMedium className="h-4 w-4" />}
        titleText={data.displayName ?? t('node.menu.relightGeneration')}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />
      <NodeLodPlaceholder title={data.displayName ?? t('node.menu.relightGeneration')} icon={<SunMedium className="h-6 w-6" />} />
      <div className="canvas-node-lod-detail flex min-h-0 flex-1 flex-col gap-2">
        <MediaInputRow
          nodeId={id}
          mediaKind="image"
          label="源图"
          maxCount={1}
          inlineValue={sourceInline}
          onInlineChange={(images) => updateNodeData(id, {
            mediaInputs: { ...(data.mediaInputs ?? {}), image: images },
          })}
        />
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-veil-subtle px-2.5 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-text-dark">{summary}</p>
            <p className="truncate text-2xs text-text-muted" title={statusText}>{statusText}</p>
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
            调整打光
          </UiButton>
        </div>
        <p className="px-1 text-2xs text-text-muted">
          方向为离散偏好；亮度、色调与轮廓光均为模型近似。
        </p>
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

RelightGenerationNode.displayName = 'RelightGenerationNode'
