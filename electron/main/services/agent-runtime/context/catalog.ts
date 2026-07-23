import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolRegistration } from '../tools/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRouteDecision } from './types'

const toolsByDomain: Readonly<Record<string, string[]>> = {
  catalog: ['search_application_capabilities'],
  navigation: ['switch_workspace'],
  models: ['search_models', 'get_model_schema'],
  generation: ['create_visible_generation_task', 'get_generation_task', 'cancel_generation_task'],
  diagnostics: ['query_diagnostic_events'],
}

export class AgentToolCatalogPlanner {
  constructor(private readonly registry: AgentToolRegistry) {}

  select(route: AgentRouteDecision, context: HostContextSnapshot | null): AgentToolRegistration[] {
    const requested = route.toolDomains.flatMap((domain) => toolsByDomain[domain] ?? [])
    const names = route.path === 'primary'
      ? ['search_application_capabilities', ...requested]
      : requested
    return this.registry.registrations([...new Set(names)].slice(0, 8), context)
  }
}
