import type { CanvasEdge, CanvasNode, ImageEditNodeData } from '../domain/canvasNodes'
import { isCanvasNodeUnavailable } from '../domain/nodeAvailability'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'
import type { RowMediaKind } from '../domain/socketTypes'
import { collectInputMedia } from './graphMediaResolver'
import {
  promptDocumentsEqual,
  promptMediaBindingsEqual,
  resolveCanvasGenerationPrompt,
  type ResolvedCanvasGenerationPrompt,
} from './generationPromptDocument'

const MEDIA_KINDS: readonly RowMediaKind[] = ['image', 'video', 'audio']

function resolveGenerationPrompt(node: CanvasNode, nodes: readonly CanvasNode[], edges: readonly CanvasEdge[],
  document: unknown, legacyText: string): ResolvedCanvasGenerationPrompt | null {
  const definition = getCanvasNodeDefinition(node.type)
  if (definition?.executionKind !== 'standard-generation' || isCanvasNodeUnavailable(node)) return null
  const data = node.data as ImageEditNodeData
  const acceptedKinds = definition.ports?.target?.accepts ?? []
  return resolveCanvasGenerationPrompt({
    nodeId: node.id,
    document,
    legacyText,
    bindings: data.promptMediaBindings,
    mediaInputs: data.mediaInputs ?? {},
    incomingMedia: collectInputMedia(node.id, [...nodes], [...edges]).filter(output => acceptedKinds.includes(output.kind)),
    acceptedMediaKinds: MEDIA_KINDS.filter(kind => acceptedKinds.includes(kind)),
  })
}

/** 附着前批量迁移自由提示词；能力节点的提示词还需先应用各自模板，仍交给原有链路。 */
export function migrateCanvasGenerationPrompts(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  let changed = false
  const migrated = nodes.map((node) => {
    const data = node.data as ImageEditNodeData
    const resolved = data.capabilityId ? null : resolveGenerationPrompt(node, nodes, edges, data.promptDocument, data.prompt ?? '')
    if (!resolved) return node
    if (promptDocumentsEqual(data.promptDocument, resolved.document)
      && promptMediaBindingsEqual(data.promptMediaBindings, resolved.bindings)
      && data.prompt === resolved.legacyText) return node
    changed = true
    return { ...node, data: { ...node.data, promptDocument: resolved.document,
      promptMediaBindings: resolved.bindings, prompt: resolved.legacyText } }
  })
  return changed ? migrated : nodes
}

/**
 * 按纯文本写提示词时，连同提示词文档一起重建：生成节点以文档为准，
 * 只改 prompt 会被节点按旧文档改回去，生成时也读不到新提示词。
 */
export function canvasGenerationPromptTextPatch(node: CanvasNode, prompt: string, nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[]): Pick<ImageEditNodeData, 'prompt' | 'promptDocument' | 'promptMediaBindings'> | null {
  const resolved = resolveGenerationPrompt(node, nodes, edges, undefined, prompt)
  return resolved && { promptDocument: resolved.document, promptMediaBindings: resolved.bindings, prompt: resolved.legacyText }
}
