import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolRegistry } from '../tools/registry'
import {
  activateAgentTools,
  type AgentToolActivationSnapshot,
} from './tool-activation'
import type { AgentRouteDecision } from './types'
// 租约名额的唯一来源。此前这里散着 5 和 15 两个字面量，把 toolBudget 的上限提上去之后
// 它们仍然在下游把租约截断——实测 place_camera_stage_object 明明已经发放，却排在第 18 位
// 被 slice(0, 15) 切掉，模型只剩通用动词，写入直接报 COLLECTION_WRITE_NOT_DECLARED。
import {
  AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  AGENT_FACET_LEASE_TOOL_LIMIT,
} from '../../../../../src/core/assistant/toolBudget'

export class AgentToolCatalogPlanner {
  private readonly leasesByFacet = new Map<string, string[]>()
  private leaseOrder: string[] = []
  private recentToolNames: string[] = []
  private continuationToolNames: string[] = []
  private recoveryToolNames: string[] = []
  private catalogRevision: string | number | null | undefined
  /** 活动工具的稳定排列；只追加不重排，保证工具 schema 落在可缓存前缀里。 */
  private toolOrder: string[] = []
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
      stableOrder: this.toolOrder,
    })
    this.toolOrder = [...new Set([...this.toolOrder, ...snapshot.activeToolNames])]
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
    const scriptApi = outputRecord.scriptApi
    if (toolName === 'discover_application_capabilities'
      && scriptApi && typeof scriptApi === 'object' && !Array.isArray(scriptApi)
      && (scriptApi as Record<string, unknown>).entryTool === 'run_henji_script') {
      return []
    }
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
      this.leasesByFacet.set(facet.facetId, [...new Set(names)].slice(0, AGENT_FACET_LEASE_TOOL_LIMIT))
      associated = true
    }
    if (!associated) this.leasesByFacet.set('catalog', leased.slice(0, AGENT_DISCOVERY_LEASE_TOOL_LIMIT))
    this.leaseOrder = [...new Set([...leased, ...this.leaseOrder])].slice(0, AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
    return leased.filter((name) => !previous.has(name))
  }

  /**
   * Facet 进入终态后释放对应租约；**只回收任务图自己发出去的那些**。
   *
   * 旧实现是"不在活动列表里就删"，于是模型自己申报的 Facet 一律被当成终态清掉。实测：用户说
   * 「你继续」，模型在发现请求里申报了 camera_project / camera_scene_add_sphere / camera_verify
   * 三个 Facet，发现层正确租约了 14 个工具（含 place_camera_stage_object），紧接着这里按任务图
   * （只有一个 clarify_goal）把另外三个 Facet 的租约全删了——模型手里只剩 5 个只读工具，最后
   * 只能回答"放置对象工具没有在本轮可用列表里，请你再发一次指令"。
   *
   * 租约是发现层对模型的承诺，回收权只能覆盖自己承诺过的范围：任务图里压根没有的 facetId
   * 说明它来自模型自报，其生命周期与 `catalog` 一致——由目录版本变化和 schema 预算兜底，
   * 不由任务图结算决定。
   */
  syncActiveFacets(activeFacetIds: string[], taskGraphFacetIds: string[] = []): void {
    const active = new Set(activeFacetIds)
    const owned = new Set(taskGraphFacetIds)
    for (const facetId of this.leasesByFacet.keys()) {
      if (facetId === 'catalog' || !owned.has(facetId)) continue
      if (!active.has(facetId)) this.leasesByFacet.delete(facetId)
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
      )).slice(0, AGENT_FACET_LEASE_TOOL_LIMIT)
      if (names.length > 0) this.leasesByFacet.set(lease.facetId, names)
    }
    this.leaseOrder = [...new Set([
      ...leases.flatMap((lease) => lease.toolNames),
      ...this.leaseOrder,
    ])].filter((name) => Boolean(this.registry.get(name))).slice(0, AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
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
    return this.leaseOrder.filter((name) => retained.has(name)).slice(0, AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
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
