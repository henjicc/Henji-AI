import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import {
  estimateAgentTextTokens,
  truncateToAgentTokenBudget,
} from '../../../../../src/core/assistant/tokenEstimate'
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

const TRUNCATION_NOTICE = '\n[本层内容已按预算截断]'

function truncateLayerContent(content: string, maxTokens: number): { content: string; truncated: boolean } {
  // 按 maxTokens 原值裁，不预扣提示语的开销：预扣会让"生产方已按 maxTokens 裁好"的层
  // （技能索引就是这么做的）在这里仍被判超，白白触发一次通用截断。提示语十来个 token 的
  // 溢出只在真正截断时才出现，可以接受。
  const result = truncateToAgentTokenBudget(content, maxTokens)
  if (!result.truncated) return { content, truncated: false }
  return { content: `${result.text}${TRUNCATION_NOTICE}`, truncated: true }
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
    const desiredTokens = Math.min(layer.maxTokens, estimateAgentTextTokens(layer.content))
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
    const estimatedTokens = estimateAgentTextTokens(String(message.content))
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
