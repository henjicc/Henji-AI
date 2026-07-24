import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import type {
  AgentContextLayer,
  AgentContextLayerId,
  AgentContextLayerReport,
} from './types'

interface LayerSelectionResult {
  messages: ModelStepMessage[]
  reports: AgentContextLayerReport[]
  retainedLayers: AgentContextLayerId[]
  droppedLayers: AgentContextLayerId[]
}

function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4))
}

function truncateLayerContent(content: string, maxTokens: number): { content: string; truncated: boolean } {
  const maxCharacters = Math.max(160, maxTokens * 4)
  if (content.length <= maxCharacters) return { content, truncated: false }
  return {
    content: `${content.slice(0, maxCharacters - 32)}\n[本层内容已按预算截断]`,
    truncated: true,
  }
}

function layerMessage(layer: AgentContextLayer, content: string): ModelStepMessage {
  return {
    role: 'user',
    content: [
      `[CONTEXT_LAYER id=${layer.id} trust=${layer.trust} source=${layer.source}]`,
      content,
      `[END_CONTEXT_LAYER id=${layer.id}]`,
    ].join('\n'),
  }
}

export function selectContextLayers(
  layers: AgentContextLayer[],
  tokenBudget: number
): LayerSelectionResult {
  let remaining = Math.max(0, tokenBudget)
  const selected = new Map<AgentContextLayerId, ModelStepMessage>()
  const reports = new Map<AgentContextLayerId, AgentContextLayerReport>()
  const ranked = [...layers].sort((left, right) => (
    Number(right.required) - Number(left.required)
    || right.priority - left.priority
  ))

  for (const layer of ranked) {
    const desiredTokens = Math.min(layer.maxTokens, estimateTextTokens(layer.content))
    const minimumTokens = layer.required ? Math.min(desiredTokens, 80) : 40
    if (!layer.required && remaining < minimumTokens) {
      reports.set(layer.id, {
        id: layer.id,
        included: false,
        estimatedTokens: 0,
        truncated: false,
        reason: '上下文预算不足，按优先级省略',
      })
      continue
    }
    const allocated = layer.required
      ? Math.max(minimumTokens, Math.min(desiredTokens, remaining || minimumTokens))
      : Math.min(desiredTokens, remaining)
    const truncated = truncateLayerContent(layer.content, allocated)
    const message = layerMessage(layer, truncated.content)
    const estimatedTokens = estimateTextTokens(String(message.content))
    selected.set(layer.id, message)
    remaining = Math.max(0, remaining - estimatedTokens)
    reports.set(layer.id, {
      id: layer.id,
      included: true,
      estimatedTokens,
      truncated: truncated.truncated,
      reason: truncated.truncated ? '超过本层或总预算，保留高优先级前部' : '在预算内保留',
    })
  }

  const orderedReports = layers.map((layer) => reports.get(layer.id) as AgentContextLayerReport)
  return {
    messages: layers.flatMap((layer) => {
      const message = selected.get(layer.id)
      return message ? [message] : []
    }),
    reports: orderedReports,
    retainedLayers: orderedReports.filter((report) => report.included).map((report) => report.id),
    droppedLayers: orderedReports.filter((report) => !report.included).map((report) => report.id),
  }
}
