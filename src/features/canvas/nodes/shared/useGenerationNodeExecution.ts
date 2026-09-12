import { useEffect, useRef } from 'react'
import { registerCanvasNodeExecutor } from '@/features/canvas/application/canvasExecutionService'
import {
  createGenerationNodeExecutor,
  type GenerationNodeExecutionOptions,
} from '@/features/canvas/application/generationNodeExecutor'

export function useGenerationNodeExecution(options: GenerationNodeExecutionOptions): void {
  // 普通重渲染只更新配置，不能替换在途执行器而造成重复生成。
  const optionsRef = useRef(options)
  optionsRef.current = options
  const nodeId = options.nodeId
  useEffect(() => registerCanvasNodeExecutor(nodeId,
    createGenerationNodeExecutor(() => optionsRef.current)), [nodeId])
}

export type {
  GenerationNodeRequestPreparation,
  GenerationNodeResultCommitContext,
  GenerationNodeResultCommitResult,
  GenerationNodeRuntimePreparationContext,
} from './generationNodeExecutionTypes'
