import { useEffect, useRef } from 'react'
import { attachCanvasGenerationFeedback } from '@/features/canvas/application/canvasDomainExecutors'
import type { GenerationNodeExecutionOptions } from '@/features/canvas/application/generationNodeExecutor'
import { useProjectStore } from '@/stores/projectStore'

export function useGenerationNodeExecution(options: Pick<GenerationNodeExecutionOptions, 'nodeId' | 'setPromptInvalid'>): void {
  const feedback = useRef(options.setPromptInvalid)
  feedback.current = options.setPromptInvalid
  const nodeId = options.nodeId
  const projectId = useProjectStore(state => state.currentProjectId)
  useEffect(() => projectId ? attachCanvasGenerationFeedback(projectId, nodeId,
    invalid => feedback.current(invalid)) : undefined, [nodeId, projectId])
}

export type {
  GenerationNodeRequestPreparation,
  GenerationNodeResultCommitContext,
  GenerationNodeResultCommitResult,
  GenerationNodeRuntimePreparationContext,
} from './generationNodeExecutionTypes'
