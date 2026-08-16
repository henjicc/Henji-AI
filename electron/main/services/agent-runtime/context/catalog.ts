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
import { AGENT_DISCOVERY_LEASE_TOOL_LIMIT } from '../../../../../src/core/assistant/toolBudget'

export class AgentToolCatalogPlanner {
  /**
   * 已发放的稳定工具租约，扁平一份，运行期常驻。
   *
   * 这里曾经按 Facet 分桶，`syncActiveFacets` 会在 Facet 进入终态时回收对应租约。任务图删除
   * 之后没有"终态 Facet"这回事了，租约只由两件**事实**回收：宿主目录版本变了（能力集合真
   * 的换了），或者某个工具在本轮真的不可用。发现层对模型的承诺不再会被一个猜测撤销。
   */
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
    this.leaseOrder = [...new Set([...leased, ...this.leaseOrder])].slice(0, AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
    return leased.filter((name) => !previous.has(name))
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
   * `TOOL_NOT_ACTIVE` 的恢复承诺是"下一轮再给你"。这一位让运行时知道这件事，避免在承诺兑现
   * 之前提前收口——实测里模型明明已经知道该调 update_camera_stage_object，却只能汇报"按规则
   * 需等下一轮披露"然后收工。
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
    this.restoreLeases(toolNames)
  }

  restoreLeases(toolNames: string[], catalogRevision?: string | number | null): void {
    if (catalogRevision !== undefined && catalogRevision !== null) {
      this.catalogRevision = catalogRevision
    }
    this.leaseOrder = [...new Set([...toolNames, ...this.leaseOrder])]
      .filter((name) => (
        !['discover_application_capabilities', 'search_application_capabilities'].includes(name)
        && Boolean(this.registry.get(name))
      ))
      .slice(0, AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
  }

  currentLeaseSnapshot(): string[] {
    return [...this.leaseOrder]
  }

  currentCatalogRevision(): string | number | null {
    return this.catalogRevision ?? null
  }

  enterCloseoutMode(): void {
    this.closeoutMode = true
  }

  private currentLeasedToolNames(): string[] {
    return this.leaseOrder.slice(0, AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
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
