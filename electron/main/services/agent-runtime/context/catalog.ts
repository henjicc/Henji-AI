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
  private continuationToolNames: string[] = []
  private recoveryToolNames: string[] = []
  private discoveryCursor = 0

  constructor(private readonly registry: AgentToolRegistry) {}

  select(
    route: AgentRouteDecision,
    context: HostContextSnapshot | null
  ): AgentToolActivationSnapshot {
    const discovered = this.rotatedDiscoveredNames()
    const pinnedToolNames = [...new Set([
      ...this.continuationToolNames,
      ...this.recoveryToolNames,
    ])]
    const snapshot = activateAgentTools(this.registry, {
      route,
      context,
      pinnedToolNames,
      discoveredToolNames: discovered,
      recentToolNames: this.recentToolNames,
    })
    const activeNameSet = new Set(snapshot.activeToolNames)
    this.recoveryToolNames = this.recoveryToolNames
      .filter((name) => !activeNameSet.has(name))
    const selectedDiscoveredCount = snapshot.activeToolNames
      .filter((name) => this.discoveredToolNames.includes(name)).length
    if (this.discoveredToolNames.length > 0 && selectedDiscoveredCount > 0) {
      this.discoveryCursor = (this.discoveryCursor + selectedDiscoveredCount)
        % this.discoveredToolNames.length
    }
    return snapshot
  }

  rememberDiscovered(toolName: string, output: unknown): string[] {
    if (!['discover_application_capabilities', 'search_application_capabilities'].includes(toolName)
      || !output || typeof output !== 'object') return []
    const outputRecord = output as Record<string, unknown>
    const capabilities = outputRecord.capabilities
    const explicitlyAdded = Array.isArray(outputRecord.addedToolNames)
      ? outputRecord.addedToolNames.filter((name): name is string => typeof name === 'string')
      : []
    if (!Array.isArray(capabilities) && explicitlyAdded.length === 0) return []
    const previous = new Set(this.discoveredToolNames)
    const candidates: string[] = []
    for (const capability of Array.isArray(capabilities) ? capabilities : []) {
      if (!capability || typeof capability !== 'object' || Array.isArray(capability)) continue
      const name = (capability as Record<string, unknown>).name
      if (typeof name !== 'string'
        || ['discover_application_capabilities', 'search_application_capabilities'].includes(name)) continue
      if (!this.registry.get(name) || candidates.includes(name)) continue
      candidates.push(name)
    }
    for (const name of explicitlyAdded) {
      if (['discover_application_capabilities', 'search_application_capabilities'].includes(name)) continue
      if (this.registry.get(name) && !candidates.includes(name)) candidates.push(name)
    }
    this.discoveredToolNames = [...new Set([...candidates, ...this.discoveredToolNames])].slice(0, 100)
    if (candidates.length > 0) this.discoveryCursor = 0
    return candidates.filter((name) => !previous.has(name))
  }

  rememberObservation(toolName: string, output?: unknown): void {
    if (['discover_application_capabilities', 'search_application_capabilities'].includes(toolName)
      || !this.registry.get(toolName)) return
    this.recentToolNames = [
      toolName,
      ...this.recentToolNames.filter((name) => name !== toolName),
    ].slice(0, 4)
    this.rememberContinuation(toolName, output)
  }

  /**
   * 还有工具在等下一轮重新披露。
   *
   * 这一位存在的唯一理由：`TOOL_NOT_ACTIVE` 的恢复承诺是"下一轮再给你"，但任务图结算不知道
   * 这件事，往往当轮就判终态并下发"停止调用工具"——承诺的下一轮永远不会来。实测里模型明明
   * 已经知道该调 update_camera_stage_object，却只能汇报"按规则需等下一轮披露"然后收工。
   */
  hasPendingActivationRecovery(): boolean {
    return this.recoveryToolNames.length > 0
  }

  queueKnownToolForActivation(toolName: string): boolean {
    if (!this.registry.get(toolName)) return false
    const known = this.discoveredToolNames.includes(toolName)
      || this.recentToolNames.includes(toolName)
      || this.continuationToolNames.includes(toolName)
    if (!known) return false
    this.recoveryToolNames = [
      toolName,
      ...this.recoveryToolNames.filter((name) => name !== toolName),
    ].slice(0, 4)
    return true
  }

  restoreDiscovered(toolNames: string[]): void {
    this.discoveredToolNames = [...new Set([
      ...toolNames.filter((name) => (
        !['discover_application_capabilities', 'search_application_capabilities'].includes(name)
        && Boolean(this.registry.get(name))
      )),
      ...this.discoveredToolNames,
    ])].slice(0, 100)
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

  private rememberContinuation(toolName: string, output: unknown): void {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return
    const record = output as Record<string, unknown>
    if (record.hasMore === false) {
      this.continuationToolNames = this.continuationToolNames
        .filter((name) => name !== toolName)
      return
    }
    const cursor = record.nextCursor
    const hasContinuationCursor = (typeof cursor === 'string' && cursor.length > 0)
      || (typeof cursor === 'number' && Number.isFinite(cursor))
    if (record.hasMore !== true || !hasContinuationCursor) return
    this.continuationToolNames = [
      toolName,
      ...this.continuationToolNames.filter((name) => name !== toolName),
    ].slice(0, 4)
  }
}
