import { findCanvasProjectInstance } from './canvasProjectInstances'
import { supportsCanvasGenerationNodeProfile, readCanvasGenerationNodeProfile } from './canvasGenerationNodeProfile'
import { createGenerationNodeExecutor } from './generationNodeExecutor'
import type { CanvasRegisteredExecutor } from './canvasExecutionContracts'
import type { useCanvasStore } from '@/stores/canvasStore'

const executors = new WeakMap<typeof useCanvasStore, Map<string, CanvasRegisteredExecutor>>()
const promptFeedback = new WeakMap<typeof useCanvasStore, Map<string, (invalid: boolean) => void>>()

/** Executors belong to the project; a view only attaches optional validation feedback. */
export function getCanvasDomainExecutor(projectId: string, nodeId: string): CanvasRegisteredExecutor | undefined {
  const instance = findCanvasProjectInstance(projectId)
  if (!instance || !supportsCanvasGenerationNodeProfile(nodeId, instance.store)) return undefined
  let entries = executors.get(instance.store)
  if (!entries) { entries = new Map(); executors.set(instance.store, entries) }
  let executor = entries.get(nodeId)
  if (!executor) {
    executor = createGenerationNodeExecutor(() => ({
      ...readCanvasGenerationNodeProfile(nodeId, instance.store),
      setPromptInvalid: invalid => promptFeedback.get(instance.store)?.get(nodeId)?.(invalid),
    }))
    entries.set(nodeId, executor)
  }
  return executor
}

export function attachCanvasGenerationFeedback(projectId: string, nodeId: string, listener: (invalid: boolean) => void): () => void {
  const instance = findCanvasProjectInstance(projectId)
  if (!instance) throw new Error('PROJECT_NOT_LOADED')
  let entries = promptFeedback.get(instance.store)
  if (!entries) { entries = new Map(); promptFeedback.set(instance.store, entries) }
  entries.set(nodeId, listener)
  return () => { if (entries.get(nodeId) === listener) entries.delete(nodeId) }
}
