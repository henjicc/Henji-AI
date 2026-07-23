import { agentToolCatalogEntrySchema, type AgentToolCatalogEntry } from '../../../../../src/core/assistant/toolContracts'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { ModelStepTool } from '../../../../../src/core/llm/modelStep'
import type { AgentToolDefinition, AgentToolRegistration } from './types'

const semanticSearchConcepts: ReadonlyArray<{ pattern: RegExp; concept: string }> = [
  { pattern: /(?:图片|图像|照片|相片|插画|海报|头像|壁纸|封面|图标|生图|image|picture|photo)/i, concept: 'media:image' },
  { pattern: /(?:视频|短片|动画|影片|video|animation)/i, concept: 'media:video' },
  { pattern: /(?:音频|音乐|歌曲|配音|语音|音效|audio|music|song|voice)/i, concept: 'media:audio' },
  { pattern: /(?:生成|制作|创建|创作|绘制|渲染|generate|generation|create|make|draw|render)/i, concept: 'action:generate' },
  { pattern: /(?:模型|供应商|model|provider)/i, concept: 'catalog:model' },
]

const categorySearchConcepts: Readonly<Record<string, string[]>> = {
  generation: ['action:generate', 'media:image', 'media:video', 'media:audio'],
  models: ['catalog:model', 'media:image', 'media:video', 'media:audio'],
  canvas: ['workspace:canvas'],
  navigation: ['action:navigate', 'action:generate'],
  diagnostics: ['action:diagnose'],
  user_instructions: ['settings:user_instructions'],
}

function normalizeSearchValue(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

function searchScore(entry: AgentToolCatalogEntry, query: string): number {
  const normalized = normalizeSearchValue(query)
  if (!normalized) return 1
  const text = normalizeSearchValue(`${entry.name} ${entry.title} ${entry.description} ${entry.category}`)
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
  return score
}

export class AgentToolRegistry {
  private readonly definitions = new Map<string, AgentToolDefinition>()

  register<TInput, TOutput>(definition: AgentToolDefinition<TInput, TOutput>): void {
    const current = this.definitions.get(definition.name)
    if (current) {
      throw new Error(`工具已注册：${definition.name}@${current.version}`)
    }
    this.definitions.set(definition.name, definition as AgentToolDefinition)
  }

  get(name: string): AgentToolDefinition | undefined {
    return this.definitions.get(name)
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
      .map((entry) => ({ entry, score: searchScore(entry, query) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
    return scored.slice(0, Math.min(Math.max(limit, 1), 20)).map((item) => item.entry)
  }

  registrations(names: string[], context: HostContextSnapshot | null): AgentToolRegistration[] {
    const uniqueNames = [...new Set(names)].slice(0, 8)
    return uniqueNames.flatMap((name) => {
      const definition = this.definitions.get(name)
      if (!definition || !this.isAvailable(definition, context)) return []
      return [{ catalog: this.toCatalogEntry(definition), modelTool: this.toModelTool(definition) }]
    })
  }

  private isAvailable(definition: AgentToolDefinition, context: HostContextSnapshot | null): boolean {
    if (definition.side === 'backend') return true
    if (!context?.uiReady) return false
    return context.availableCommands.includes(definition.name)
      || context.availableQueries.includes(definition.name)
  }

  private toCatalogEntry(definition: AgentToolDefinition): AgentToolCatalogEntry {
    return agentToolCatalogEntrySchema.parse({
      name: definition.name,
      version: definition.version,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      side: definition.side,
      risk: definition.risk,
      permission: definition.permission,
      readOnly: definition.readOnly,
      supportsPreview: definition.supportsPreview,
      supportsUndo: definition.supportsUndo,
    })
  }

  private toModelTool(definition: AgentToolDefinition): ModelStepTool {
    return {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.aiInputSchema,
      strict: true,
    }
  }
}
