import { findCanvasProjectInstance } from './canvasProjectInstances'
import { supportsCanvasGenerationNodeProfile, readCanvasGenerationNodeProfile } from './canvasGenerationNodeProfile'
import { createGenerationNodeExecutor } from './generationNodeExecutor'
import type { CanvasRegisteredExecutor } from './canvasExecutionContracts'
import type { useCanvasStore } from '@/stores/canvasStore'
import { createTextProcessingExecutor } from './textProcessingExecutor'
import { listTextProcessingModels } from './textProcessing'
import { llmConfigService } from '@/services/llm/LlmConfigService'
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import i18n from '@/i18n'
import { createMultiAngleNodeExecutor } from './multiAngleNodeExecutor'
import { createRelightNodeExecutor } from './relightNodeExecutor'
import { createStoryboardNodeExecutor } from './storyboardNodeExecutor'

const executors = new WeakMap<typeof useCanvasStore, Map<string, CanvasRegisteredExecutor>>()
interface NodeFeedback { setPromptInvalid: (invalid: boolean) => void; onMissingModel?: () => void; onError?: (message: string | null) => void }
const promptFeedback = new WeakMap<typeof useCanvasStore, Map<string, NodeFeedback>>()

/** Executors belong to the project; a view only attaches optional validation feedback. */
export function getCanvasDomainExecutor(projectId: string, nodeId: string): CanvasRegisteredExecutor | undefined {
  const instance = findCanvasProjectInstance(projectId)
  if (!instance) return undefined
  const node = instance.store.getState().nodes.find(entry => entry.id === nodeId)
  if (!node) return undefined
  const isText = node.type === CANVAS_NODE_TYPES.textProcessing
  const isStoryboard = node.type === CANVAS_NODE_TYPES.storyboardGen
  const special = node.type === CANVAS_NODE_TYPES.multiAngleGen ? createMultiAngleNodeExecutor
    : node.type === CANVAS_NODE_TYPES.relightGen ? createRelightNodeExecutor : undefined
  if (!isText && !isStoryboard && !special && !supportsCanvasGenerationNodeProfile(nodeId, instance.store)) return undefined
  let entries = executors.get(instance.store)
  if (!entries) { entries = new Map(); executors.set(instance.store, entries) }
  let executor = entries.get(nodeId)
  if (!executor) {
    const feedback = () => promptFeedback.get(instance.store)?.get(nodeId)
    executor = isStoryboard ? createStoryboardNodeExecutor(nodeId, instance.store, {
      onError: message => feedback()?.onError?.(message), onMissingModel: () => feedback()?.onMissingModel?.(),
    }) : special ? special(nodeId, instance.store) : isText ? createTextProcessingExecutor(nodeId, instance.store, async () => {
      const config = await llmConfigService.getConfig()
      return { choices: listTextProcessingModels(config), promptTemplates: config.textProcessingPromptTemplates,
        setPromptInvalid: invalid => feedback()?.setPromptInvalid(invalid),
        onMissingModel: () => feedback()?.onMissingModel?.(), t: i18n.t.bind(i18n) }
    }) : createGenerationNodeExecutor(() => ({
      ...readCanvasGenerationNodeProfile(nodeId, instance.store),
      setPromptInvalid: invalid => feedback()?.setPromptInvalid(invalid),
    }))
    entries.set(nodeId, executor)
  }
  return executor
}

export function attachCanvasGenerationFeedback(projectId: string, nodeId: string, listener: (invalid: boolean) => void,
  onMissingModel?: () => void, onError?: (message: string | null) => void): () => void {
  const instance = findCanvasProjectInstance(projectId)
  if (!instance) throw new Error('PROJECT_NOT_LOADED')
  let entries = promptFeedback.get(instance.store)
  if (!entries) { entries = new Map(); promptFeedback.set(instance.store, entries) }
  const feedback = { setPromptInvalid: listener, onMissingModel, onError }
  entries.set(nodeId, feedback)
  return () => { if (entries.get(nodeId) === feedback) entries.delete(nodeId) }
}
