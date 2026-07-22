import type {
  PromptReferenceItem,
  PromptReferenceResolver,
  PromptReferenceSuggestionProvider,
  PromptVariableItem,
  PromptVariableResolver,
  PromptVariableSuggestionProvider,
} from './types'

export interface PromptEditorResourceState {
  references: readonly PromptReferenceItem[]
  variables: readonly PromptVariableItem[]
  resolveReference?: PromptReferenceResolver
  resolveVariable?: PromptVariableResolver
  getReferenceSuggestions?: PromptReferenceSuggestionProvider
  getVariableSuggestions?: PromptVariableSuggestionProvider
  suggestionContainer?: string | HTMLElement
}

const EMPTY_RESOURCE_STATE: PromptEditorResourceState = {
  references: [],
  variables: [],
}

function includesQuery(label: string, query: string): boolean {
  return label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}

export class PromptEditorResourceRegistry {
  private state: PromptEditorResourceState
  private version = 0
  private readonly listeners = new Set<() => void>()

  constructor(initialState: PromptEditorResourceState = EMPTY_RESOURCE_STATE) {
    this.state = initialState
  }

  update(state: PromptEditorResourceState): void {
    this.state = state
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): number => this.version

  getServerSnapshot = (): number => 0

  resolveReference(resourceId: string): PromptReferenceItem | undefined {
    return this.state.resolveReference?.(resourceId)
      ?? this.state.references.find((item) => item.resourceId === resourceId)
  }

  getReferences(): readonly PromptReferenceItem[] {
    return this.state.references
  }

  resolveVariable(key: string): PromptVariableItem | undefined {
    return this.state.resolveVariable?.(key)
      ?? this.state.variables.find((item) => item.key === key)
  }

  async getReferenceSuggestions(query: string): Promise<readonly PromptReferenceItem[]> {
    const provided = this.state.getReferenceSuggestions
      ? await this.state.getReferenceSuggestions(query)
      : this.state.references.filter((item) => includesQuery(item.label, query))
    return provided.slice(0, 8)
  }

  async getVariableSuggestions(query: string): Promise<readonly PromptVariableItem[]> {
    const provided = this.state.getVariableSuggestions
      ? await this.state.getVariableSuggestions(query)
      : this.state.variables.filter((item) => (
        includesQuery(item.label, query) || includesQuery(item.key, query)
      ))
    return provided.slice(0, 8)
  }

  getSuggestionContainer(): string | HTMLElement | undefined {
    return this.state.suggestionContainer
  }
}
