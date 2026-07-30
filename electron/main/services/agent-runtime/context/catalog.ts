import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolRegistry } from '../tools/registry'
import {
  activateAgentTools,
  type AgentToolActivationSnapshot,
} from './tool-activation'
import type { AgentRouteDecision } from './types'

export class AgentToolCatalogPlanner {
  private discoveredToolNames: string[] = []
  private recentToolNames: string[] = []
  private discoveryCursor = 0

  constructor(private readonly registry: AgentToolRegistry) {}

  select(
    route: AgentRouteDecision,
    context: HostContextSnapshot | null
  ): AgentToolActivationSnapshot {
    const discovered = this.rotatedDiscoveredNames()
    const snapshot = activateAgentTools(this.registry, {
      route,
      context,
      discoveredToolNames: discovered,
      recentToolNames: this.recentToolNames,
    })
    const selectedDiscoveredCount = snapshot.activeToolNames
      .filter((name) => this.discoveredToolNames.includes(name)).length
    if (this.discoveredToolNames.length > 0 && selectedDiscoveredCount > 0) {
      this.discoveryCursor = (this.discoveryCursor + selectedDiscoveredCount)
        % this.discoveredToolNames.length
    }
    return snapshot
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
    }
    this.discoveredToolNames = [...new Set([...candidates, ...this.discoveredToolNames])].slice(0, 100)
    if (candidates.length > 0) this.discoveryCursor = 0
    return candidates.filter((name) => !previous.has(name))
  }

  rememberObservation(toolName: string): void {
    if (toolName === 'search_application_capabilities' || !this.registry.get(toolName)) return
    this.recentToolNames = [
      toolName,
      ...this.recentToolNames.filter((name) => name !== toolName),
    ].slice(0, 4)
  }

  private rotatedDiscoveredNames(): string[] {
    if (this.discoveredToolNames.length < 2 || this.discoveryCursor === 0) {
      return [...this.discoveredToolNames]
    }
    return [
      ...this.discoveredToolNames.slice(this.discoveryCursor),
      ...this.discoveredToolNames.slice(0, this.discoveryCursor),
    ]
  }
}
