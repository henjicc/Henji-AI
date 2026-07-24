import type {
  AgentMemoryLayer,
  AgentMemoryRecord,
  AgentMemoryRetrievalQuery,
} from '../../../../src/core/assistant/memory'

export interface AgentMemoryRelevanceScore {
  score: number
  reasons: string[]
  layer: AgentMemoryLayer
}

function normalizedTerms(value: string): Set<string> {
  const normalized = value.normalize('NFKC').toLowerCase()
  const terms = new Set(normalized.match(/[a-z0-9][a-z0-9._-]{1,}|[\p{Script=Han}]{2,}/gu) ?? [])
  const chinese = normalized.replace(/[^\p{Script=Han}]/gu, '')
  for (let index = 0; index < chinese.length - 1; index += 1) {
    terms.add(chinese.slice(index, index + 2))
  }
  return terms
}

function scopeScore(
  memory: AgentMemoryRecord,
  query: AgentMemoryRetrievalQuery
): { score: number; reason: string } | null {
  if (memory.scope.type === 'global') return { score: 8, reason: '全局作用域匹配' }
  if (memory.scope.type === 'workspace') {
    return memory.scope.id === query.workspaceId
      ? { score: 18, reason: '当前工作区匹配' }
      : null
  }
  return memory.scope.id === query.projectId
    ? { score: 28, reason: '当前项目精确匹配' }
    : null
}

function memoryLayer(memory: AgentMemoryRecord): AgentMemoryLayer {
  if (memory.kind === 'preference') return 'confirmed_preference'
  if (memory.kind === 'workflow') return 'workflow_knowledge'
  return 'project_knowledge'
}

function recencyScore(updatedAt: string): number {
  const ageDays = Math.max(0, (Date.now() - Date.parse(updatedAt)) / (24 * 60 * 60 * 1_000))
  if (ageDays <= 7) return 6
  if (ageDays <= 30) return 4
  if (ageDays <= 90) return 2
  return 0
}

export function scoreAgentMemory(
  memory: AgentMemoryRecord,
  query: AgentMemoryRetrievalQuery
): AgentMemoryRelevanceScore | null {
  const scope = scopeScore(memory, query)
  if (!scope) return null
  const queryTerms = normalizedTerms([
    query.goal,
    query.intent ?? '',
    ...query.toolDomains,
    ...query.stepSignals,
  ].join(' '))
  const memoryTerms = normalizedTerms(memory.content)
  const overlap = [...memoryTerms].filter((term) => queryTerms.has(term)).length
  const preferenceContext = memory.kind === 'preference'
    && ['generate', 'inspect_model', 'user_instructions', 'memory'].includes(query.intent ?? '')
  const projectContext = memory.scope.type === 'project'
    && ['canvas', 'storyboard', 'workflow', 'image_edit', 'assets'].includes(query.intent ?? '')
  if (overlap === 0 && !preferenceContext && !projectContext) return null

  const reasons = [scope.reason]
  let score = scope.score
  if (overlap > 0) {
    score += Math.min(40, overlap * 6)
    reasons.push(`目标与记忆命中 ${overlap} 个实体或语义词`)
  }
  if (preferenceContext) {
    score += 16
    reasons.push('已确认偏好与当前选择任务相关')
  }
  if (projectContext) {
    score += 12
    reasons.push('项目知识与当前项目任务相关')
  }
  if (/纠正|更正|替换/.test(memory.sourceLabel)) {
    score += 10
    reasons.push('来源是用户较新的明确纠正')
  }
  const recency = recencyScore(memory.updatedAt)
  if (recency > 0) {
    score += recency
    reasons.push('最近更新')
  }
  return { score, reasons: reasons.slice(0, 8), layer: memoryLayer(memory) }
}
