import type { CanvasEdge, CanvasNode, ImageEditNodeData } from '../domain/canvasNodes'
import { isCanvasNodeUnavailable } from '../domain/nodeAvailability'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'
import type { RowMediaKind } from '../domain/socketTypes'
import { collectInputMedia } from './graphMediaResolver'
import {
  promptDocumentsEqual,
  promptMediaBindingsEqual,
  resolveCanvasGenerationPrompt,
} from './generationPromptDocument'

const MEDIA_KINDS: readonly RowMediaKind[] = ['image', 'video', 'audio']

/** 附着前批量迁移自由提示词；能力节点的提示词还需先应用各自模板，仍交给原有链路。 */
export function migrateCanvasGenerationPrompts(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  let changed = false
  const migrated = nodes.map((node) => {
    const definition = getCanvasNodeDefinition(node.type)
    if (definition?.executionKind !== 'standard-generation' || isCanvasNodeUnavailable(node)) return node
    const data = node.data as ImageEditNodeData
    if (data.capabilityId) return node
    const acceptedKinds = definition.ports?.target?.accepts ?? []
    const resolved = resolveCanvasGenerationPrompt({
      nodeId: node.id,
      document: data.promptDocument,
      legacyText: data.prompt ?? '',
      bindings: data.promptMediaBindings,
      mediaInputs: data.mediaInputs ?? {},
      incomingMedia: collectInputMedia(node.id, nodes, edges).filter(output => acceptedKinds.includes(output.kind)),
      acceptedMediaKinds: MEDIA_KINDS.filter(kind => acceptedKinds.includes(kind)),
    })
    if (promptDocumentsEqual(data.promptDocument, resolved.document)
      && promptMediaBindingsEqual(data.promptMediaBindings, resolved.bindings)
      && data.prompt === resolved.legacyText) return node
    changed = true
    return { ...node, data: { ...node.data, promptDocument: resolved.document,
      promptMediaBindings: resolved.bindings, prompt: resolved.legacyText } }
  })
  return changed ? migrated : nodes
}
