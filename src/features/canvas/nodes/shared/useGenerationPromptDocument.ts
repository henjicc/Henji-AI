import { useCallback, useEffect, useMemo } from 'react'

import type { PromptReferenceItem } from '@/components/ui'
import {
  parseLegacyPromptString,
  toLegacyPromptString,
  toModelPromptText,
  type PromptDocumentV1,
  type PromptMediaBinding,
} from '@/core/inputs/promptDocument'
import {
  promptDocumentsEqual,
  promptMediaBindingsEqual,
  resolveCanvasGenerationPrompt,
} from '@/features/canvas/application/generationPromptDocument'
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData'
import type { NodeMediaOutput } from '@/features/canvas/domain/nodePorts'
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes'
import {
  createCanvasTextHistoryGroup,
  useCanvasEditHistory,
} from '@/features/canvas/hooks/useCanvasTextHistory'
import { useCanvasStore } from '@/stores/canvasStore'

export interface GenerationNodeShellData {
  displayName?: string
  prompt: string
  promptDocument?: PromptDocumentV1
  promptMediaBindings?: PromptMediaBinding[]
  modelId?: string
  params?: DynamicValueMap
  /** 媒体行未连线时的本地内联上传值 */
  mediaInputs?: Partial<Record<RowMediaKind, string[]>>
  /** 视频裁剪窗口选中的范围（秒），仅是元数据，不替换 mediaInputs.video 里的完整视频引用 */
  videoTrimStart?: number
  videoTrimEnd?: number
  [key: string]: DynamicValue
}

interface UseGenerationPromptDocumentParams {
  nodeId: string
  data: GenerationNodeShellData
  mediaInputs: Partial<Record<RowMediaKind, string[]>>
  incomingMedia: readonly NodeMediaOutput[]
  acceptedMediaKinds: readonly RowMediaKind[]
  isPromptOverridden: boolean
  promptOverrideValue: string | null
  invalid: boolean
  onValidContent: () => void
}

export interface UseGenerationPromptDocumentResult {
  document: PromptDocumentV1
  references: PromptReferenceItem[]
  mediaUrls: Record<RowMediaKind, string[]>
  handleChange: (document: PromptDocumentV1) => void
  handleMediaInputChange: (kind: RowMediaKind, values: string[]) => void
  onEditEnd: () => void
}

export function useGenerationPromptDocument({
  nodeId,
  data,
  mediaInputs,
  incomingMedia,
  acceptedMediaKinds,
  isPromptOverridden,
  promptOverrideValue,
  invalid,
  onValidContent,
}: UseGenerationPromptDocumentParams): UseGenerationPromptDocumentResult {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  // 节点 data 是唯一受控来源；不要再镜像一份本地 document state。
  // Tiptap 会即时持有当前 transaction，本地镜像若早于 ReactFlow 新 props 渲染，
  // 会用旧文档反向 setContent，导致中间输入后的 selection 跳到末尾。
  const resolvedCarrier = useMemo(() => resolveCanvasGenerationPrompt({
    nodeId,
    document: data.promptDocument,
    legacyText: data.prompt ?? '',
    bindings: data.promptMediaBindings,
    mediaInputs,
    incomingMedia,
    acceptedMediaKinds,
  }), [
    acceptedMediaKinds,
    data.prompt,
    data.promptDocument,
    data.promptMediaBindings,
    incomingMedia,
    mediaInputs,
    nodeId,
  ])
  const references = useMemo(
    () => resolvedCarrier.references.map((reference) => ({
      resourceId: reference.resourceId,
      mediaType: reference.mediaType,
      label: reference.label,
      legacyLabels: reference.legacyLabels,
      ...(reference.sourceNodeId ? { sourceNodeId: reference.sourceNodeId } : {}),
      ...(
        reference.mediaType === 'image' || reference.previewUrl
          ? { thumbnailSrc: resolveImageDisplayUrl(reference.previewUrl ?? reference.mediaUrl) }
          : {}
      ),
    })),
    [resolvedCarrier.references],
  )
  const historyGroup = useMemo(
    () => createCanvasTextHistoryGroup(nodeId, 'prompt'),
    [nodeId],
  )
  const editHistory = useCanvasEditHistory(historyGroup)

  useEffect(() => {
    const needsMigration = !promptDocumentsEqual(data.promptDocument, resolvedCarrier.document)
      || !promptMediaBindingsEqual(data.promptMediaBindings, resolvedCarrier.bindings)
      || data.prompt !== resolvedCarrier.legacyText
    if (!needsMigration) return
    updateNodeData(nodeId, {
      promptDocument: resolvedCarrier.document,
      promptMediaBindings: resolvedCarrier.bindings,
      prompt: resolvedCarrier.legacyText,
    }, { skipHistory: true })
  }, [
    data.prompt,
    data.promptDocument,
    data.promptMediaBindings,
    nodeId,
    resolvedCarrier.bindings,
    resolvedCarrier.document,
    resolvedCarrier.legacyText,
    updateNodeData,
  ])

  const handleChange = useCallback((nextDocument: PromptDocumentV1): void => {
    const legacyText = toLegacyPromptString(nextDocument, { references })
    updateNodeData(nodeId, {
      promptDocument: nextDocument,
      prompt: legacyText,
    }, { historyGroup: editHistory.historyGroup })
    if (invalid && toModelPromptText(nextDocument, { references }).trim()) {
      onValidContent()
    }
  }, [editHistory.historyGroup, invalid, nodeId, onValidContent, references, updateNodeData])

  const handleMediaInputChange = useCallback((kind: RowMediaKind, next: string[]): void => {
    const nextMediaInputs = { ...mediaInputs, [kind]: next }
    const nextCarrier = resolveCanvasGenerationPrompt({
      nodeId,
      document: resolvedCarrier.document,
      legacyText: data.prompt ?? '',
      bindings: data.promptMediaBindings,
      mediaInputs: nextMediaInputs,
      incomingMedia,
      acceptedMediaKinds,
    })
    updateNodeData(nodeId, {
      mediaInputs: nextMediaInputs,
      promptDocument: nextCarrier.document,
      promptMediaBindings: nextCarrier.bindings,
      prompt: nextCarrier.legacyText,
    })
  }, [
    acceptedMediaKinds,
    data.prompt,
    data.promptMediaBindings,
    incomingMedia,
    mediaInputs,
    nodeId,
    resolvedCarrier.document,
    updateNodeData,
  ])

  const overrideDocument = useMemo(
    () => isPromptOverridden
      ? parseLegacyPromptString(promptOverrideValue ?? '', { references })
      : null,
    [isPromptOverridden, promptOverrideValue, references],
  )

  return {
    document: overrideDocument ?? resolvedCarrier.document,
    references,
    mediaUrls: resolvedCarrier.mediaUrls,
    handleChange,
    handleMediaInputChange,
    onEditEnd: editHistory.onEditEnd,
  }
}
