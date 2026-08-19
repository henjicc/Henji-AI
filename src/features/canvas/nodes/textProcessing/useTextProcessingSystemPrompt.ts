import { useCallback, useEffect, useMemo } from 'react'

import {
  readPromptDocument,
  toLegacyPromptString,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'
import { promptDocumentsEqual } from '@/features/canvas/application/generationPromptDocument'
import type { TextProcessingNodeData } from '@/features/canvas/domain/canvasNodes'
import {
  createCanvasTextHistoryGroup,
  useCanvasEditHistory,
} from '@/features/canvas/hooks/useCanvasTextHistory'
import { useCanvasStore } from '@/stores/canvasStore'

interface TextProcessingSystemPromptState {
  document: PromptDocumentV1
  handleChange: (document: PromptDocumentV1) => void
  onEditEnd: () => void
}

export function useTextProcessingSystemPrompt(
  nodeId: string,
  data: TextProcessingNodeData,
): TextProcessingSystemPromptState {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const document = useMemo(() => readPromptDocument({
    document: data.systemPromptDocument,
    legacyText: data.systemPrompt ?? '',
  }, {
    carrierType: 'canvas-text-processing-system-prompt',
    carrierId: nodeId,
  }).document, [data.systemPrompt, data.systemPromptDocument, nodeId])
  const legacyText = useMemo(() => toLegacyPromptString(document), [document])
  const historyGroup = useMemo(
    () => createCanvasTextHistoryGroup(nodeId, 'systemPrompt'),
    [nodeId],
  )
  const editHistory = useCanvasEditHistory(historyGroup)

  useEffect(() => {
    if (
      data.systemPrompt === legacyText
      && promptDocumentsEqual(data.systemPromptDocument, document)
    ) return
    updateNodeData(nodeId, {
      systemPrompt: legacyText,
      systemPromptDocument: document,
    }, { skipHistory: true })
  }, [data.systemPrompt, data.systemPromptDocument, document, legacyText, nodeId, updateNodeData])

  const handleChange = useCallback((nextDocument: PromptDocumentV1): void => {
    updateNodeData(nodeId, {
      systemPrompt: toLegacyPromptString(nextDocument),
      systemPromptDocument: nextDocument,
    }, { historyGroup: editHistory.historyGroup })
  }, [editHistory.historyGroup, nodeId, updateNodeData])

  return {
    document,
    handleChange,
    onEditEnd: editHistory.onEditEnd,
  }
}
