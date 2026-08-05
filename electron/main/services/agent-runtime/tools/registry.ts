import { agentToolCatalogEntrySchema, type AgentToolCatalogEntry } from '../../../../../src/core/assistant/toolContracts'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { ModelStepTool } from '../../../../../src/core/llm/modelStep'
import { assertAgentToolDefinition } from './define-tool'
import type { AgentToolDefinition, AgentToolRegistration, AgentToolSemantics } from './types'

const semanticSearchConcepts: ReadonlyArray<{ pattern: RegExp; concept: string }> = [
  { pattern: /(?:图片|图像|照片|相片|插画|海报|头像|壁纸|封面|图标|生图|image|picture|photo)/i, concept: 'media:image' },
  { pattern: /(?:视频|短片|动画|影片|video|animation)/i, concept: 'media:video' },
  { pattern: /(?:音频|音乐|歌曲|配音|语音|音效|audio|music|song|voice)/i, concept: 'media:audio' },
  { pattern: /(?:生成|制作|创建|创作|绘制|渲染|generate|generation|create|make|draw|render)/i, concept: 'action:generate' },
  { pattern: /(?:模型|供应商|model|provider)/i, concept: 'catalog:model' },
  { pattern: /(?:素材|资源|asset|library)/i, concept: 'workspace:assets' },
  { pattern: /(?:编辑|裁剪|旋转|标注|edit|crop|rotate|mark)/i, concept: 'action:edit' },
  { pattern: /(?:镜头|运镜|3d|camera|shot)/i, concept: 'action:camera' },
  { pattern: /(?:工作流|编排|流程|workflow|orchestration)/i, concept: 'action:workflow' },
]

const categorySearchConcepts: Readonly<Record<string, string[]>> = {
  generation: ['action:generate', 'media:image', 'media:video', 'media:audio'],
  models: ['catalog:model', 'media:image', 'media:video', 'media:audio'],
  canvas: ['workspace:canvas'],
  navigation: ['action:navigate', 'action:generate'],
  diagnostics: ['action:diagnose'],
  user_instructions: ['settings:user_instructions'],
  memory: ['settings:memory'],
  toolbox: ['workspace:toolbox'],
  camera_stage: ['workspace:toolbox', 'media:image', 'action:render', 'action:camera'],
  storyboard: ['workspace:canvas', 'action:generate'],
  image_edit: ['workspace:toolbox', 'media:image', 'action:edit'],
  assets: ['workspace:assets', 'media:image', 'media:video', 'media:audio'],
  workflows: ['action:generate', 'workspace:canvas', 'workspace:toolbox'],
  artifacts: ['runtime:artifact'],
}

function normalizeSearchValue(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

function searchScore(
  entry: AgentToolCatalogEntry,
  query: string,
  context: HostContextSnapshot | null
): number {
  const normalized = normalizeSearchValue(query)
  if (!normalized) return 1
  const text = normalizeSearchValue([
    entry.name,
    entry.title,
    entry.description,
    entry.category,
    entry.domain,
    ...entry.aliases,
    ...entry.whenToUse,
    ...entry.avoidWhen,
    ...entry.prerequisites,
    ...entry.outputs,
    ...entry.successEvidence,
    ...entry.failureRecovery,
  ].join(' '))
  const rawTerms = normalized.split(/[\s,，。;；:：/\\|]+/).filter(Boolean)
  const concepts = semanticSearchConcepts
    .filter((item) => item.pattern.test(normalized))
    .map((item) => item.concept)
  const supportedConcepts = categorySearchConcepts[entry.category] ?? []
  let score = text.includes(normalized) ? 100 : 0
  for (const term of rawTerms) {
    if (text.includes(term)) score += 10
  }
  for (const concept of concepts) {
    if (supportedConcepts.includes(concept)) score += 20
  }
  const surfaceId = context?.surface?.id ?? ''
  if (
    surfaceId.includes(entry.domain)
    || surfaceId === 'workspace.generation' && entry.domain === 'generation'
    || surfaceId === 'tool.image_edit' && entry.domain === 'image_edit'
  ) {
    score += 35
  }
  const selectedKinds = context?.surface?.selectedRefs
    .map((ref) => ref.split(':', 1)[0])
    ?? []
  if (entry.acceptsRefs.some((kind) => selectedKinds.includes(kind))) score += 25
  return score
}

function resolveToolSemantics(definition: AgentToolDefinition): Required<AgentToolSemantics> {
  const parallelSafe = definition.semantics?.parallelSafe
    ?? (definition.readOnly && !definition.destructive && definition.risk === 'R0')
  return {
    whenToUse: definition.semantics?.whenToUse ?? [definition.description],
    avoidWhen: definition.semantics?.avoidWhen ?? [
      definition.destructive
        ? '目标、作用范围或用户授权不明确时不要使用。'
        : '缺少必需输入或有更精确的查询工具时不要猜测参数。',
    ],
    prerequisites: definition.semantics?.prerequisites ?? (
      definition.requiredContext.length > 0
        ? definition.requiredContext.map((scope) => `宿主 ${scope} 作用域已就绪且 revision 未过期。`)
        : ['无额外宿主作用域要求；输入仍必须通过 schema 校验。']
    ),
    outputs: definition.semantics?.outputs ?? [
      '返回经过 output schema 校验和脱敏的结构化观察结果。',
      definition.supportsUndo ? '成功结果可能包含可撤销引用。' : '不承诺可撤销引用。',
    ],
    successEvidence: definition.semantics?.successEvidence ?? [
      '工具网关返回 completed，且结构化输出通过 schema 校验。',
      definition.readOnly ? '读取结果包含请求目标的稳定标识或状态摘要。' : '写入结果包含目标标识及 resulting revision、状态或撤销引用。',
    ],
    failureRecovery: definition.semantics?.failureRecovery ?? [
      'STALE_CONTEXT 或 CONFLICT：刷新宿主快照后重新规划。',
      'TIMEOUT 或 NOT_READY：有限等待后再决定是否重试。',
      'NOT_FOUND、INVALID_INPUT 或权限拒绝：修正目标/参数或向用户澄清。',
    ],
    completionKind: definition.semantics?.completionKind
      ?? (definition.readOnly ? 'observed' : 'executed'),
    parallelSafe,
  }
}

function modelToolDescription(definition: AgentToolDefinition): string {
  const semantics = definition.semantics
  const specific = [
    definition.description,
    `影响：${definition.readOnly ? '只读' : '写入'}，风险 ${definition.risk}${definition.supportsUndo ? '，支持撤销' : ''}。`,
  ]
  if (semantics?.whenToUse?.length) specific.push(`适用：${semantics.whenToUse.join('；')}`)
  if (semantics?.prerequisites?.length) specific.push(`特有前置：${semantics.prerequisites.join('；')}`)
  if (semantics?.successEvidence?.length) specific.push(`特有成功证据：${semantics.successEvidence.join('；')}`)
  if (semantics?.failureRecovery?.length) specific.push(`特有恢复：${semantics.failureRecovery.join('；')}`)
  /*
   * 示例调用放在描述末尾。
   *
   * JSON Schema 表达不了嵌套结构长什么样、可选字段什么时候该填、几个参数怎么配合——而这些正是
   * 模型最容易写错的地方。Anthropic 实测补上示例后复杂参数场景准确率 72% → 90%。
   * 单条截断到 400 字节、每工具最多 2 条：描述预算 128KB，实测只用了 12.9KB，但没必要浪费。
   */
  for (const example of (definition.inputExamples ?? []).slice(0, 2)) {
    const serialized = JSON.stringify(example)
    if (!serialized) continue
    specific.push(`示例调用：${serialized.length > 400 ? `${serialized.slice(0, 400)}…` : serialized}`)
  }
  return specific.join('\n')
}

function modelInputSchema(definition: AgentToolDefinition): Record<string, unknown> {
  const schema = structuredClone(definition.aiInputSchema)
  if (!definition.capability) return schema
  const properties = schema.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    delete (properties as Record<string, unknown>).baseRevision
    delete (properties as Record<string, unknown>).expectedRevisions
  }
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((name) => (
      name !== 'baseRevision' && name !== 'expectedRevisions'
    ))
  }
  return schema
}

export interface AgentToolExecutionMetadata {
  title: string
  completionKind: AgentToolCatalogEntry['completionKind']
  parallelSafe: boolean
  concurrencyKey: string
  risk: AgentToolDefinition['risk']
  category: string
  readOnly: boolean
  idempotent: boolean
}

export class AgentToolRegistry {
  private readonly definitions = new Map<string, AgentToolDefinition>()

  register<TInput, TOutput>(definition: AgentToolDefinition<TInput, TOutput>): void {
    assertAgentToolDefinition(definition)
    const current = this.definitions.get(definition.name)
    if (current) {
      throw new Error(`工具已注册：${definition.name}@${current.version}`)
    }
    this.definitions.set(definition.name, definition as AgentToolDefinition)
  }

  get(name: string): AgentToolDefinition | undefined {
    return this.definitions.get(name)
  }

  allDefinitions(): AgentToolDefinition[] {
    return [...this.definitions.values()]
  }

  list(context: HostContextSnapshot | null = null): AgentToolCatalogEntry[] {
    return [...this.definitions.values()]
      .filter((definition) => this.isAvailable(definition, context))
      .map((definition) => this.toCatalogEntry(definition))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  search(query: string, category?: string, context: HostContextSnapshot | null = null, limit = 20): AgentToolCatalogEntry[] {
    const scored = this.list(context)
      .filter((entry) => !category || entry.category === category)
      .map((entry) => ({ entry, score: searchScore(entry, query, context) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
    return scored.slice(0, Math.min(Math.max(limit, 1), 100)).map((item) => item.entry)
  }

  registrations(names: string[], context: HostContextSnapshot | null): AgentToolRegistration[] {
    const uniqueNames = [...new Set(names)].slice(0, 100)
    return uniqueNames.flatMap((name) => {
      const definition = this.definitions.get(name)
      if (!definition || !this.isAvailable(definition, context)) return []
      return [{ catalog: this.toCatalogEntry(definition), modelTool: this.toModelTool(definition) }]
    })
  }

  executionMetadata(name: string, input: unknown): AgentToolExecutionMetadata | null {
    const definition = this.definitions.get(name)
    if (!definition) return null
    const parsed = definition.inputSchema.safeParse(input)
    if (!parsed.success) return null
    return {
      title: definition.title,
      completionKind: resolveToolSemantics(definition).completionKind,
      parallelSafe: resolveToolSemantics(definition).parallelSafe,
      concurrencyKey: definition.concurrencyKey(parsed.data),
      risk: definition.risk,
      category: definition.category,
      readOnly: definition.readOnly,
      idempotent: definition.idempotent,
    }
  }

  private isAvailable(definition: AgentToolDefinition, context: HostContextSnapshot | null): boolean {
    if (definition.side === 'backend') return true
    if (!context?.uiReady) return false
    if (context.availableCapabilities) {
      return context.availableCapabilities.includes(definition.name)
    }
    return false
  }

  private toCatalogEntry(definition: AgentToolDefinition): AgentToolCatalogEntry {
    const semantics = resolveToolSemantics(definition)
    const capability = definition.capability
      ? {
          id: definition.capability.id,
          domain: definition.capability.domain,
          aliases: definition.capability.aliases,
          dataClasses: definition.capability.dataClasses,
          acceptsRefs: definition.capability.acceptsRefs,
          producesRefs: definition.capability.producesRefs,
          availability: definition.capability.availability,
          concurrencyKey: definition.capability.concurrencyKey,
        }
      : {
          id: definition.name,
          domain: definition.category,
          aliases: [],
          dataClasses: ['C0'] as const,
          acceptsRefs: [],
          producesRefs: [],
          availability: definition.requiredContext.map((scope) => `${scope} 作用域可用`),
          concurrencyKey: definition.category,
        }
    return agentToolCatalogEntrySchema.parse({
      name: definition.name,
      capabilityId: capability.id,
      version: definition.version,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      domain: capability.domain,
      aliases: capability.aliases,
      side: definition.side,
      risk: definition.risk,
      permission: definition.permission,
      readOnly: definition.readOnly,
      supportsPreview: definition.supportsPreview,
      supportsUndo: definition.supportsUndo,
      dataClasses: capability.dataClasses,
      acceptsRefs: capability.acceptsRefs,
      producesRefs: capability.producesRefs,
      availability: capability.availability,
      concurrencyKey: capability.concurrencyKey,
      ...semantics,
    })
  }

  private toModelTool(definition: AgentToolDefinition): ModelStepTool {
    return {
      name: definition.name,
      description: modelToolDescription(definition),
      inputSchema: modelInputSchema(definition),
      strict: true,
    }
  }
}
