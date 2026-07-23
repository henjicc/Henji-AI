import { agentToolCatalogEntrySchema, type AgentToolCatalogEntry } from '../../../../../src/core/assistant/toolContracts'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { ModelStepTool } from '../../../../../src/core/llm/modelStep'
import type { AgentToolDefinition, AgentToolRegistration } from './types'

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
    const normalized = query.trim().toLowerCase()
    return this.list(context).filter((entry) => {
      if (category && entry.category !== category) return false
      if (!normalized) return true
      return `${entry.name} ${entry.title} ${entry.description} ${entry.category}`.toLowerCase().includes(normalized)
    }).slice(0, Math.min(Math.max(limit, 1), 20))
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
    return definition.requiredContext.every((scope) => {
      if (scope === 'generation') return context.generation.commandReady
      return true
    })
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
