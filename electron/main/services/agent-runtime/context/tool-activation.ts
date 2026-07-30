import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolRegistration } from '../tools/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRouteDecision } from './types'

export const AGENT_ACTIVE_TOOL_LIMIT = 8
export const AGENT_TOOL_SCHEMA_BUDGET_BYTES = 48 * 1024
const CAPABILITY_SEARCH_TOOL = 'search_application_capabilities'

export interface AgentToolActivationInput {
  route: AgentRouteDecision
  context: HostContextSnapshot | null
  discoveredToolNames: string[]
  recentToolNames: string[]
}

export interface AgentToolActivationSnapshot {
  registrations: AgentToolRegistration[]
  activeToolNames: string[]
  schemaBytes: number
  candidateCount: number
  droppedForCount: string[]
  droppedForSchemaBudget: string[]
  unavailableNames: string[]
}

function registrationBytes(registration: AgentToolRegistration): number {
  return Buffer.byteLength(JSON.stringify(registration.modelTool), 'utf8')
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function activateAgentTools(
  registry: AgentToolRegistry,
  input: AgentToolActivationInput
): AgentToolActivationSnapshot {
  const available = registry.list(input.context)
  const availableNames = new Set(available.map((entry) => entry.name))
  const directCategories = input.route.toolDomains.filter((domain) => domain !== 'catalog')
  const directNames = directCategories.flatMap((category) => (
    available.filter((entry) => entry.category === category).map((entry) => entry.name)
  ))
  const candidates = unique([
    CAPABILITY_SEARCH_TOOL,
    ...input.recentToolNames,
    ...input.discoveredToolNames,
    ...directNames,
  ])
  const unavailableNames = candidates.filter((name) => !availableNames.has(name))
  const availableCandidates = candidates.filter((name) => availableNames.has(name))
  const registrations = registry.registrations(availableCandidates, input.context)
  const active: AgentToolRegistration[] = []
  const droppedForCount: string[] = []
  const droppedForSchemaBudget: string[] = []
  let schemaBytes = 0

  for (const registration of registrations) {
    const bytes = registrationBytes(registration)
    if (active.length >= AGENT_ACTIVE_TOOL_LIMIT) {
      droppedForCount.push(registration.catalog.name)
      continue
    }
    if (schemaBytes + bytes > AGENT_TOOL_SCHEMA_BUDGET_BYTES && active.length > 0) {
      droppedForSchemaBudget.push(registration.catalog.name)
      continue
    }
    active.push(registration)
    schemaBytes += bytes
  }

  return {
    registrations: active,
    activeToolNames: active.map((registration) => registration.catalog.name),
    schemaBytes,
    candidateCount: availableCandidates.length,
    droppedForCount,
    droppedForSchemaBudget,
    unavailableNames,
  }
}
