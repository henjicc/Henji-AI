import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolRegistration } from '../tools/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRouteDecision } from './types'

const toolsByDomain: Readonly<Record<string, string[]>> = {
  catalog: ['search_application_capabilities'],
  navigation: ['switch_workspace'],
  models: ['search_models', 'get_model_schema'],
  generation: ['create_visible_generation_task', 'get_generation_task', 'cancel_generation_task'],
  user_instructions: ['get_user_instructions', 'update_user_instructions'],
  diagnostics: ['query_diagnostic_events'],
  canvas: [
    'list_canvas_projects',
    'open_canvas_project',
    'search_canvas_node_types',
    'get_canvas_node_schema',
    'add_canvas_node',
    'connect_canvas_nodes',
    'focus_canvas_node',
    'undo_canvas_change',
  ],
}

export class AgentToolCatalogPlanner {
  private discoveredToolNames: string[] = []

  constructor(private readonly registry: AgentToolRegistry) {}

  select(route: AgentRouteDecision, context: HostContextSnapshot | null): AgentToolRegistration[] {
    const requested = route.toolDomains.flatMap((domain) => toolsByDomain[domain] ?? [])
    const discovered = route.path === 'primary' ? this.discoveredToolNames : []
    const names = route.path === 'primary'
      ? ['search_application_capabilities', ...requested, ...discovered]
      : requested
    return this.registry.registrations([...new Set(names)].slice(0, 8), context)
  }

  rememberDiscovered(toolName: string, output: unknown): string[] {
    if (toolName !== 'search_application_capabilities' || !output || typeof output !== 'object') return []
    const capabilities = (output as Record<string, unknown>).capabilities
    if (!Array.isArray(capabilities)) return []
    const previous = new Set(this.discoveredToolNames)
    const candidates: string[] = []
    for (const capability of capabilities) {
      if (!capability || typeof capability !== 'object' || Array.isArray(capability)) continue
      const name = (capability as Record<string, unknown>).name
      if (typeof name !== 'string' || name === 'search_application_capabilities') continue
      if (!this.registry.get(name) || candidates.includes(name)) continue
      candidates.push(name)
      if (candidates.length >= 20) break
    }
    this.discoveredToolNames = [...new Set([...candidates, ...this.discoveredToolNames])].slice(0, 20)
    return candidates.filter((name) => !previous.has(name))
  }
}
