import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolRegistry } from '../tools/registry'
import {
  activateAgentTools,
  type AgentToolActivationSnapshot,
} from './tool-activation'
import type { AgentRouteDecision } from './types'

export class AgentToolCatalogPlanner {
  private readonly leasesByFacet = new Map<string, string[]>()
  private leaseOrder: string[] = []
  private recentToolNames: string[] = []
  private continuationToolNames: string[] = []
  private recoveryToolNames: string[] = []
  private catalogRevision: string | number | null | undefined
  private closeoutMode = false

  constructor(private readonly registry: AgentToolRegistry) {}

  select(
    route: AgentRouteDecision,
    context: HostContextSnapshot | null
  ): AgentToolActivationSnapshot {
    if (this.catalogRevision !== undefined && this.catalogRevision !== context?.catalogRevision) {
      this.leasesByFacet.clear()
      this.leaseOrder = []
    }
    this.catalogRevision = context?.catalogRevision
    const leasedToolNames = this.currentLeasedToolNames()
    const pinnedToolNames = [...new Set([
      ...this.continuationToolNames,
      ...this.recoveryToolNames,
    ])].slice(0, 4)
    const snapshot = activateAgentTools(this.registry, {
      route,
      context,
      pinnedToolNames,
      leasedToolNames,
      recentToolNames: this.recentToolNames,
      closeoutMode: this.closeoutMode,
    })
    const activeNameSet = new Set(snapshot.activeToolNames)
    this.recoveryToolNames = this.recoveryToolNames
      .filter((name) => !activeNameSet.has(name))
    if (snapshot.unavailableNames.length > 0) {
      const unavailable = new Set(snapshot.unavailableNames)
      for (const [facetId, toolNames] of this.leasesByFacet.entries()) {
        const retained = toolNames.filter((name) => !unavailable.has(name))
        if (retained.length > 0) this.leasesByFacet.set(facetId, retained)
        else this.leasesByFacet.delete(facetId)
      }
      this.leaseOrder = this.leaseOrder.filter((name) => !unavailable.has(name))
    }
    return snapshot
  }

  rememberDiscovered(toolName: string, output: unknown): string[] {
    if (!['discover_application_capabilities', 'search_application_capabilities'].includes(toolName)
      || !output || typeof output !== 'object') return []
    const outputRecord = output as Record<string, unknown>
    const explicitlyLeased = Array.isArray(outputRecord.leasedToolNames)
      ? outputRecord.leasedToolNames.filter((name): name is string => typeof name === 'string')
      : []
    if (explicitlyLeased.length === 0) return []
    const previous = new Set(this.currentLeasedToolNames())
    const leased = explicitlyLeased.flatMap((name) => {
      if (['discover_application_capabilities', 'search_application_capabilities'].includes(name)) return []
      return this.registry.get(name) ? [name] : []
    })
    const leaseSet = new Set(leased)
    const facets = Array.isArray(outputRecord.facets) ? outputRecord.facets : []
    let associated = false
    for (const rawFacet of facets) {
      if (!rawFacet || typeof rawFacet !== 'object' || Array.isArray(rawFacet)) continue
      const facet = rawFacet as Record<string, unknown>
      if (typeof facet.facetId !== 'string' || !Array.isArray(facet.capabilityNames)) continue
      const names = facet.capabilityNames.filter((name): name is string => (
        typeof name === 'string' && leaseSet.has(name)
      ))
      if (names.length === 0) continue
      this.leasesByFacet.set(facet.facetId, [...new Set(names)].slice(0, 5))
      associated = true
    }
    if (!associated) this.leasesByFacet.set('catalog', leased.slice(0, 15))
    this.leaseOrder = [...new Set([...leased, ...this.leaseOrder])].slice(0, 15)
    return leased.filter((name) => !previous.has(name))
  }

  /** Facet 进入终态后立即释放对应租约；当前依赖前沿以外的活动 Facet 仍保留。 */
  syncActiveFacets(activeFacetIds: string[]): void {
    const active = new Set(activeFacetIds)
    for (const facetId of this.leasesByFacet.keys()) {
      if (facetId !== 'catalog' && !active.has(facetId)) this.leasesByFacet.delete(facetId)
    }
    const retained = new Set([...this.leasesByFacet.values()].flat())
    this.leaseOrder = this.leaseOrder.filter((name) => retained.has(name))
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
    const known = this.currentLeasedToolNames().includes(toolName)
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
    this.restoreLeases([{ facetId: 'catalog', toolNames }])
  }

  restoreLeases(
    leases: Array<{ facetId: string; toolNames: string[] }>,
    catalogRevision?: string | number | null
  ): void {
    if (catalogRevision !== undefined && catalogRevision !== null) {
      this.catalogRevision = catalogRevision
    }
    for (const lease of leases) {
      const names = lease.toolNames.filter((name) => (
        !['discover_application_capabilities', 'search_application_capabilities'].includes(name)
        && Boolean(this.registry.get(name))
      )).slice(0, 5)
      if (names.length > 0) this.leasesByFacet.set(lease.facetId, names)
    }
    this.leaseOrder = [...new Set([
      ...leases.flatMap((lease) => lease.toolNames),
      ...this.leaseOrder,
    ])].filter((name) => Boolean(this.registry.get(name))).slice(0, 15)
  }

  currentLeaseSnapshot(): Array<{ facetId: string; toolNames: string[] }> {
    return [...this.leasesByFacet.entries()].map(([facetId, toolNames]) => ({ facetId, toolNames: [...toolNames] }))
  }

  currentCatalogRevision(): string | number | null {
    return this.catalogRevision ?? null
  }

  enterCloseoutMode(): void {
    this.closeoutMode = true
  }

  private currentLeasedToolNames(): string[] {
    const retained = new Set([...this.leasesByFacet.values()].flat())
    return this.leaseOrder.filter((name) => retained.has(name)).slice(0, 15)
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
