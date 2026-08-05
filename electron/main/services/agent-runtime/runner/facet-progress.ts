import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import {
  AGENT_FACET_EVIDENCE_LIMIT,
  agentFacetProgressSchema,
  type AgentFacetProgress,
  type AgentProgressSettlement,
} from '../../../../../src/core/assistant/progress'
import type { AgentObservedEffect, AgentTaskActionGroup, AgentTaskFacet, AgentTaskGraph } from '../../../../../src/core/assistant/taskGraph'
import type { AgentToolErrorCode, AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentToolRegistry } from '../tools/registry'
import { createMainLogger } from '../../logging'
import { AGENT_LEASE_FRONTIER_FACET_LIMIT } from '../../../../../src/core/assistant/toolBudget'
import { digestJson } from '../tools/security'
import {
  AgentEffectLedger,
  asRecord,
  callSignature,
  effectMatches,
  isTerminal,
  observationFailure,
  overlapsForVerification,
  potentialEffectMatches,
  resolveObservedEffects,
  stableEvidence,
  type CallRecord,
  type ObservationFailure,
  type EffectLedgerSnapshotEntry,
  type RestoredEffectLedgerEntry,
} from './facet-effect-ledger'
import {
  hasSufficientActionPlan as checkSufficientActionPlan,
  prepareDeclaredActionPlan,
  resolveActionGroupForCall,
  type PreparedDeclaredActionPlan,
} from './facet-action-plan'
import { buildAgentProgressSettlement, buildSettlementGuidance } from './facet-settlement'
import { buildUserResumeProgress, listActiveFacetIds, listDependencyFrontierFacetIds } from './facet-progress-state'
import {
  buildCapabilityDiscoveryInputForFacets,
  listDiscoverableFacets,
} from '../../../../../src/core/assistant/capabilityDiscovery'

const logger = createMainLogger('main.agent_runtime')

export interface AgentProgressGuardDecision {
  code?: AgentToolErrorCode
  reason: string
  events: AgentFacetProgress[]
  issueCodes?: string[]
}

export class AgentFacetProgressTracker {
  private taskGraph: AgentTaskGraph
  private requiresExplicitActionPlan: boolean
  private readonly facets = new Map<string, AgentTaskFacet>()
  private readonly callRecords = new Map<string, CallRecord>()
  private readonly observationDigests = new Map<string, Set<string>>()
  private readonly effectLedger: AgentEffectLedger
  private readonly discoveredSchemas = new Set<string>()
  private readonly discoveredFacetIds = new Set<string>()
  private readonly schemaFacetIds = new Map<string, Set<string>>()
  private readonly pendingEvents: AgentFacetProgress[] = []

  /** 允许在 Facet 自身 domain 之外额外搜索的领域（会话延续证据 + 模型自报需求的并集）。 */
  private readonly extraDiscoveryDomains = new Set<string>()

  /** 路由判定的领域，只用于遥测：补建的 Facet 落在这之外就说明路由判错了。 */
  private readonly routeDomains: readonly string[]

  /** 已经向模型下发过的结算状态；状态不变就不重复下发。 */
  private announcedSettlementStatus: AgentProgressSettlement['status'] | null = null

  constructor(
    initialTaskGraph: AgentTaskGraph,
    private readonly registry: AgentToolRegistry,
    requiresExplicitActionPlan = false,
    restoredLedger: RestoredEffectLedgerEntry[] = [],
    restoredLeaseFacetIds: string[] = [],
    continuationDomains: readonly string[] = []
  ) {
    for (const domain of continuationDomains) this.extraDiscoveryDomains.add(domain)
    this.routeDomains = [...new Set([
      ...continuationDomains,
      ...initialTaskGraph.facets.map((facet) => facet.domain),
    ])]
    this.taskGraph = initialTaskGraph
    this.requiresExplicitActionPlan = requiresExplicitActionPlan
    for (const facetId of restoredLeaseFacetIds) {
      if (facetId !== 'catalog') this.discoveredFacetIds.add(facetId)
    }
    this.effectLedger = new AgentEffectLedger(initialTaskGraph, restoredLedger)
    for (const facet of initialTaskGraph.facets) {
      this.facets.set(facet.facetId, { ...facet })
    }
  }

  taskGraphSnapshot(): AgentTaskGraph {
    return {
      ...this.taskGraph,
      facets: this.taskGraph.facets.map((facet) => this.facets.get(facet.facetId) ?? facet),
    }
  }

  actionGroupForCall(
    call: ModelStepToolCall
  ): Pick<AgentTaskActionGroup, 'actionGroupId' | 'mode'> | null {
    return resolveActionGroupForCall({
      call,
      taskGraph: this.taskGraph,
      matchingFacets: this.facetsForCall(call),
      registry: this.registry,
    })
  }

  effectLedgerSnapshot(): EffectLedgerSnapshotEntry[] {
    return this.effectLedger.snapshot()
  }

  hasSufficientActionPlan(writeCallCount: number): boolean {
    return checkSufficientActionPlan(
      [...this.facets.values()],
      this.requiresExplicitActionPlan,
      writeCallCount
    )
  }

  prepareDeclaredActionPlan(declaration: unknown): PreparedDeclaredActionPlan {
    return prepareDeclaredActionPlan({
      declaration,
      taskGraph: this.taskGraph,
      facets: this.facets,
      // 补建 Facet 的领域必须来自真实注册表：模型可以纠正路由，但编不出不存在的领域。
      knownDomains: new Set(this.registry.allDefinitions().flatMap((definition) => [
        definition.category,
        definition.capability?.domain ?? definition.category,
      ])),
      // 有过观察摘要就说明这个 Facet 已经动过手，不允许被一句话作废。
      touchedFacetIds: new Set(this.observationDigests.keys()),
    })
  }

  commitDeclaredActionPlan(prepared: Extract<PreparedDeclaredActionPlan, { ok: true }>): void {
    const before = new Map([...this.facets].map(([id, facet]) => [id, facet.status]))
    this.taskGraph = prepared.taskGraph
    this.requiresExplicitActionPlan = false
    this.facets.clear()
    for (const facet of prepared.taskGraph.facets) {
      this.facets.set(facet.facetId, { ...facet })
      if (prepared.declaredFacetIds.has(facet.facetId)) this.observationDigests.delete(facet.facetId)
    }
    this.effectLedger.rebuild(prepared.taskGraph, prepared.declaredFacetIds)
    /*
     * 记录"路由结论被推翻"这件事本身。
     *
     * "要不要保留独立的意图路由模型"目前无法回答，因为没有任何数据说明它多久错一次——上一轮
     * 那个 3/3 全错是人工翻日志得到的。补建与作废是路由判错的唯一可观测信号，从这里开始计量。
     */
    for (const facet of prepared.taskGraph.facets) {
      const previousStatus = before.get(facet.facetId)
      if (previousStatus === undefined) {
        logger.info('Agent 任务图补建 Facet', {
          event: 'agent_task_graph.facet.declared',
          context: {
            facetId: facet.facetId,
            domain: facet.domain,
            routeDomains: this.routeDomains,
            inRouteDomains: this.routeDomains.includes(facet.domain),
          },
        })
      } else if (facet.status === 'superseded' && previousStatus !== 'superseded') {
        logger.info('Agent 任务图作废 Facet', {
          event: 'agent_task_graph.facet.superseded',
          context: { facetId: facet.facetId, domain: facet.domain, routeDomains: this.routeDomains },
        })
      }
    }
  }

  /**
   * 把模型申报、但不在任务图前沿里的 Facet 并进发现请求。
   *
   * 这是"谁来选工具"的分水岭。Anthropic 的 Tool Search 由**主模型**驱动检索（实测工具选择
   * 准确率 79.5% → 88.1%）；本项目的等价物是能力发现 + 租约，但旧实现把模型的请求整个改写成
   * 运行时前沿——模型写的 facetId / entityTypes / capabilityKinds 除 queries 和 domains 外全部
   * 丢弃。于是主模型（唯一拿得到完整会话历史的那个）连"我要的东西在另一个领域"都表达不了。
   *
   * 并入的门槛与补建 Facet 一致：entityTypes 必须指向真实注册领域。发现本身是只读的，
   * 权限仍由 registry.list(context) 与审批把关，放宽发现范围不越权。
   */
  private mergeDeclaredFacets(targets: AgentTaskFacet[], rawInput: unknown): AgentTaskFacet[] {
    const input = asRecord(rawInput)
    if (!Array.isArray(input?.facets)) return targets
    const known = new Set(targets.map((facet) => facet.facetId))
    const knownDomains = new Set(this.registry.allDefinitions().flatMap((definition) => [
      definition.category,
      definition.capability?.domain ?? definition.category,
    ]))
    const merged = [...targets]
    for (const rawFacet of input.facets) {
      const declared = asRecord(rawFacet)
      if (typeof declared?.facetId !== 'string' || known.has(declared.facetId)) continue
      if (merged.length >= AGENT_LEASE_FRONTIER_FACET_LIMIT) break
      const entityTypes = Array.isArray(declared.entityTypes)
        ? declared.entityTypes.filter((value): value is string => typeof value === 'string')
        : []
      const domain = entityTypes
        .map((entityType) => (entityType.includes('.')
          ? entityType.slice(0, entityType.indexOf('.'))
          : entityType))
        .find((candidate) => knownDomains.has(candidate))
      if (!domain) continue
      known.add(declared.facetId)
      merged.push({
        facetId: declared.facetId,
        domain,
        goal: typeof declared.goal === 'string' && declared.goal ? declared.goal : this.taskGraph.goal,
        targetEntityTypes: entityTypes,
        requiredObservations: [],
        capabilityKinds: ['observe', 'mutate', 'execute'],
        targetSurfaceId: null,
        dependsOn: [],
        parallelizable: false,
        completionConditions: ['目标动作具有结构化结果或明确的受阻说明。'],
        requiredEffects: [],
        uncertainties: [],
        confidence: 0.5,
        status: 'active',
        statusReason: '模型在发现请求里申报的领域，运行时并入本轮检索范围。',
        evidence: [],
      })
    }
    return merged
  }

  activeFacetIds(): string[] {
    return listActiveFacetIds([...this.facets.values()])
  }

  /** 任务图当前持有的全部 facetId（任何状态）。租约回收只能覆盖这个范围，见 catalog.syncActiveFacets。 */
  allFacetIds(): string[] {
    return [...this.facets.keys()]
  }

  dependencyFrontierFacetIds(limit?: number): string[] {
    return listDependencyFrontierFacetIds([...this.facets.values()], limit)
  }

  /**
   * 把能力发现请求改写成运行时唯一正确的那一份，而不是拒绝模型。
   *
   * 依赖前沿和它的 requiredEffects 全都是运行时可以直接算出来的；让模型去复述这份集合，猜错
   * 就判 INVALID_INPUT，只会白白烧掉一轮并计进连续失败预算。更糟的是当前沿 Facet 已全部持有
   * 租约时旧实现返回"允许：无"，于是任何后续发现都必然失败——而让前沿推进所需要的只读观察
   * 能力恰好又没被租到，整次运行就此死锁（实测的三维建场景任务就是这样断在第 11 轮）。
   *
   * 现在：前沿一律并入请求（模型漏掉依赖也不会卡住），但**模型自己申报的 Facet 同样并入**，
   * 而不是被覆盖掉——见下面 mergeDeclaredFacets 的说明。重复发现交给 no_change 计数做软刹车。
   */
  normalizeCallInput(call: ModelStepToolCall): unknown | null {
    if (call.toolName !== 'discover_application_capabilities') return null
    const scope = listDiscoverableFacets([...this.facets.values()])
    if (scope.length === 0) return null
    const undiscovered = scope.filter((facet) => !this.discoveredFacetIds.has(facet.facetId))
    const targets = this.mergeDeclaredFacets(
      undiscovered.length > 0 ? undiscovered : scope,
      call.input
    )
    const input = asRecord(call.input)
    const extraQueries: Record<string, string[]> = {}
    if (Array.isArray(input?.facets)) {
      for (const rawFacet of input.facets) {
        const facet = asRecord(rawFacet)
        if (typeof facet?.facetId !== 'string') continue
        if (Array.isArray(facet.queries)) {
          extraQueries[facet.facetId] = facet.queries.filter(
            (query): query is string => typeof query === 'string' && query.length > 0
          )
        }
        /*
         * 模型自己申报的领域必须收下。
         *
         * 这是它唯一能说出"我要的能力不在这个域里"的地方。旧实现把 domains 整个覆盖成
         * [facet.domain]，模型即使准确诊断出"当前上下文未持有 camera_stage 租约"也无处申诉，
         * 只能把工具可用性当成意图证据，反过来推翻自己原本正确的判断——实测就是这么坏的。
         * 领域只放宽不收窄，权限仍由 registry.list(context) 与审批把关，放宽本身不越权。
         */
        if (Array.isArray(facet.domains)) {
          for (const domain of facet.domains) {
            if (typeof domain === 'string' && domain.length > 0 && domain.length <= 128) {
              this.extraDiscoveryDomains.add(domain)
            }
          }
        }
      }
    }
    return buildCapabilityDiscoveryInputForFacets(
      targets,
      extraQueries,
      [...this.extraDiscoveryDomains]
    )
  }

  validate(
    call: ModelStepToolCall,
    expectedRevisions: Partial<HostScopeRevisions>,
    allowSettledActionGroupSibling = false
  ): AgentProgressGuardDecision | null {
    const settlement = this.settlement()
    /*
     * 「任务图声明的 Effect 已满足」不等于「用户的目标达成」，因此不构成停止的理由。
     *
     * 任务图是路由或兜底规则对用户目标的**粗糙近似**。实测：用户要"白色球体"，兜底任务图只生成
     * 了一条 effect，place 一成功就结算 completed，这道闸门当场拒绝一切后续工具——模型自己清楚
     * 球体还不是白的（答复里写着"未完成/待确认：球体的材质颜色"），却连 update_camera_stage_object
     * 都调不动，只能回一句"需要我确认球体为纯白色时，回复一声即可"。用户看到的就是"每一步都要
     * 我跟他说一声"。
     *
     * 真正该拦的是**没有新进展**，那由下面的 repeated_write / repeated_failure / no_change 和运行
     * 预算负责，它们判的是事实而不是近似。这里只保留两种确实做不下去的终态：等用户、以及全盘受阻。
     */
    const mustStop = settlement.status === 'waiting_user'
      || (settlement.status === 'blocked' && settlement.completedFacetIds.length === 0)
    if (mustStop && !allowSettledActionGroupSibling) {
      return {
        reason: `任务图已结算为 ${settlement.status}，禁止继续调用工具；请输出结构化完成或受阻说明。`,
        events: [],
      }
    }
    const definition = this.registry.get(call.toolName)
    if (definition && !definition.readOnly && call.toolName !== 'declare_action_plan'
      && this.facetsForCall(call, undefined, allowSettledActionGroupSibling).length === 0) {
      const expected = [...this.facets.values()]
        .filter((facet) => !isTerminal(facet.status))
        .flatMap((facet) => facet.requiredEffects.map((required) => (
          `${facet.facetId}:${required.effect}${required.entityTypes.length > 0 ? `(${required.entityTypes.join('/')})` : ''}`
        )))
        .slice(0, 12)
      return {
        code: 'ACTION_PLAN_REQUIRED',
        reason: `${call.toolName} 的 effect、实体或属性不在当前任务图里。任务图待办 Effect：${expected.join('、') || '无'}；`
          + '如果这个写入确实是任务的一部分，用 declare_action_plan 补声明该 Effect（只需 effect/entityTypes/minimumCount）。'
          // 路由只看得到当前这一句话，判错领域是常态；模型拿得到完整会话历史，必须有权纠正它。
          + '任务图里没有合适的 facetId 时，直接用一个新的 facetId 声明：只要 entityTypes 指向真实实体类型'
          + '（形如 camera_stage.object），运行时会按该实体所属领域补建 Facet 并发放对应能力。',
        events: [],
        issueCodes: ['ACTION_EFFECT_MISMATCH'],
      }
    }
    const signature = callSignature(call, expectedRevisions)
    const record = this.callRecords.get(signature)
    if (!record) return null
    let kind: AgentFacetProgress['kind'] | null = null
    let reason = ''
    if (record.succeededWrite && definition && !definition.readOnly) {
      kind = 'repeated_write'
      reason = `${call.toolName} 已在相同 base revision 和参数下成功，拒绝重复写入。`
    } else if (record.lastErrorCode && ['CONFLICT', 'STALE_CONTEXT'].includes(record.lastErrorCode)) {
      kind = 'revision_conflict'
      reason = `${call.toolName} 的 revision 冲突后尚未观察新状态，拒绝使用相同 base revision 重试。`
    } else if (record.failureCount >= 2) {
      kind = 'repeated_failure'
      reason = `${call.toolName} 以相同参数连续失败，拒绝继续无效重试。`
    } else if (record.noChangeCount >= 2) {
      kind = 'no_change'
      reason = `${call.toolName} 连续没有产生 revision、验证差异或新 schema，拒绝继续调用。`
    }
    if (!kind) return null
    const events = this.facetsForCall(call).flatMap((facet) => (
      isTerminal(facet.status) ? [] : [this.blockFacet(facet.facetId, kind, reason, signature)]
    ))
    return { reason, events }
  }

  observe(input: {
    call: ModelStepToolCall
    observation: AgentToolObservation
    expectedRevisions: Partial<HostScopeRevisions>
  }): AgentFacetProgress[] {
    const signature = callSignature(input.call, input.expectedRevisions)
    const record = this.callRecords.get(signature) ?? {
      attempts: 0,
      failureCount: 0,
      noChangeCount: 0,
      lastErrorCode: null,
      succeededWrite: false,
    }
    record.attempts += 1
    this.callRecords.set(signature, record)
    const failure = observationFailure(input.observation)
    if (failure) return this.recordFailure(input.call, signature, record, failure)
    if (input.call.toolName === 'discover_application_capabilities') {
      return this.recordDiscovery(input.observation, signature, record)
    }
    if (input.call.toolName === 'read_application_schemas') {
      return this.recordSchemas(input.call, input.observation, signature, record)
    }
    if (input.call.toolName === 'declare_action_plan') {
      return []
    }
    return this.recordSuccess(input.call, input.observation, signature, record)
  }

  settlement(): AgentProgressSettlement {
    return buildAgentProgressSettlement([...this.facets.values()])
  }

  settlementGuidance(): string | null {
    const settlement = this.settlement()
    // 结算状态没变就不重复下发：completed 不再是停止令之后，模型可能继续干好几轮，
    // 每轮都贴一遍同样的检查点纯属噪音，还会把它推向"反正说过了，收尾吧"。
    if (settlement.status === this.announcedSettlementStatus) return null
    this.announcedSettlementStatus = settlement.status
    return buildSettlementGuidance(settlement)
  }

  resumeWaitingFacets(answer: string): AgentFacetProgress[] {
    return buildUserResumeProgress({
      facets: [...this.facets.values()], callRecords: this.callRecords.values(), answer,
    }).map((progress) => this.progressFacet(progress))
  }

  drainPendingEvents(): AgentFacetProgress[] {
    return this.pendingEvents.splice(0, this.pendingEvents.length)
  }

  private recordFailure(
    call: ModelStepToolCall,
    signature: string,
    record: CallRecord,
    failure: ObservationFailure
  ): AgentFacetProgress[] {
    record.failureCount += 1
    record.lastErrorCode = failure.code
    const facets = this.facetsForCall(call)
    if (failure.code === 'PERMISSION_DENIED') {
      return facets.map((facet) => this.blockFacet(
        facet.facetId, 'permission_blocked', failure.message, signature
      ))
    }
    const needsUserInput = record.failureCount >= 2
      && failure.recovery === 'user_action'
      && ['INVALID_INPUT', 'NOT_FOUND'].includes(failure.code)
    if (failure.code === 'APPROVAL_EXPIRED' || needsUserInput) {
      return facets.map((facet) => this.progressFacet({
        facetId: facet.facetId,
        status: 'waiting_user',
        kind: 'waiting_user',
        summary: failure.message,
        evidence: [`error:${failure.code}`],
        executionFingerprint: signature,
        blocker: `继续该 Facet 需要用户提供输入或重新确认：${failure.message}`,
      }))
    }
    if (failure.code === 'APPROVAL_REJECTED') {
      return facets.map((facet) => this.blockFacet(
        facet.facetId, 'permission_blocked', failure.message, signature
      ))
    }
    if (record.failureCount >= 2) {
      return facets.map((facet) => this.blockFacet(
        facet.facetId, 'repeated_failure', `${failure.code} 重复失败：${failure.message}`, signature
      ))
    }
    return facets.map((facet) => this.progressFacet({
      facetId: facet.facetId,
      status: 'active',
      kind: ['CONFLICT', 'STALE_CONTEXT'].includes(failure.code) ? 'revision_conflict' : 'no_change',
      summary: `${call.toolName} 返回 ${failure.code}，尚未取得新进展。`,
      evidence: [`error:${failure.code}`],
      executionFingerprint: signature,
    }))
  }

  private recordDiscovery(
    observation: AgentToolObservation,
    signature: string,
    record: CallRecord
  ): AgentFacetProgress[] {
    const output = asRecord(observation.output)
    const fingerprint = typeof output?.fingerprint === 'string' ? output.fingerprint : signature
    const missing = Array.isArray(output?.missing) ? output.missing : []
    const results = Array.isArray(output?.facets) ? output.facets : []
    const events: AgentFacetProgress[] = []
    for (const item of missing) {
      const value = asRecord(item)
      if (typeof value?.facetId !== 'string') continue
      events.push(this.blockFacet(
        value.facetId,
        'capability_missing',
        `批量发现明确返回 ${String(value.reason ?? 'no_matching_capability')}。`,
        fingerprint
      ))
    }
    let discoveredNewSchema = false
    for (const item of results) {
      const value = asRecord(item)
      if (typeof value?.facetId !== 'string' || missing.some((entry) => asRecord(entry)?.facetId === value.facetId)) continue
      const facetId = value.facetId
      this.discoveredFacetIds.add(facetId)
      const schemaRefs = Array.isArray(value.schemaRefs) ? value.schemaRefs : []
      const newDigests = schemaRefs.flatMap((ref) => {
        const digest = asRecord(ref)?.digest
        if (typeof digest !== 'string') return []
        const facetIds = this.schemaFacetIds.get(digest) ?? new Set<string>()
        facetIds.add(facetId)
        this.schemaFacetIds.set(digest, facetIds)
        if (this.discoveredSchemas.has(digest)) return []
        this.discoveredSchemas.add(digest)
        return [digest]
      })
      discoveredNewSchema ||= newDigests.length > 0
      events.push(this.progressFacet({
        facetId,
        status: 'active',
        kind: newDigests.length > 0 ? 'schema_discovered' : 'repeated_discovery',
        summary: newDigests.length > 0
          ? '已一次取得该 Facet 的能力摘要和稳定 schemaRef。'
          : '已恢复该 Facet 的既有能力租约，不再重复发现。',
        evidence: [`discovery:${fingerprint}`, ...newDigests.slice(0, 4)],
        executionFingerprint: fingerprint,
      }))
    }
    if (!discoveredNewSchema) record.noChangeCount += 1
    return events
  }

  private recordSchemas(
    call: ModelStepToolCall,
    observation: AgentToolObservation,
    signature: string,
    record: CallRecord
  ): AgentFacetProgress[] {
    const output = asRecord(observation.output)
    const documents = Array.isArray(output?.documents) ? output.documents : []
    const relatedFacetIds = new Set<string>()
    const newDigests = documents.flatMap((document) => {
      const schemaDigest = asRecord(asRecord(document)?.ref)?.digest
      if (typeof schemaDigest !== 'string') return []
      for (const facetId of this.schemaFacetIds.get(schemaDigest) ?? []) relatedFacetIds.add(facetId)
      if (this.discoveredSchemas.has(`read:${schemaDigest}`)) return []
      this.discoveredSchemas.add(`read:${schemaDigest}`)
      return [schemaDigest]
    })
    if (newDigests.length === 0) record.noChangeCount += 1
    const facets = relatedFacetIds.size > 0
      ? [...relatedFacetIds].flatMap((facetId) => {
          const facet = this.facets.get(facetId)
          return facet && !isTerminal(facet.status) ? [facet] : []
        })
      : this.facetsForCall(call)
    return facets.map((facet) => this.progressFacet({
      facetId: facet.facetId,
      status: 'active',
      kind: newDigests.length > 0 ? 'schema_discovered' : 'no_change',
      summary: newDigests.length > 0 ? '已读取新的完整能力输入结构。' : 'schema 读取没有带来新信息。',
      evidence: newDigests.slice(0, 8),
      executionFingerprint: signature,
    }))
  }

  private recordSuccess(
    call: ModelStepToolCall,
    observation: AgentToolObservation,
    signature: string,
    record: CallRecord
  ): AgentFacetProgress[] {
    const definition = this.registry.get(call.toolName)
    const evidence = stableEvidence(observation)
    const outputDigest = digestJson(observation.output)
    const observedEffects = resolveObservedEffects(this.registry, call, observation, evidence)
    if (definition && !definition.readOnly) record.succeededWrite = true
    return this.facetsForCall(call, observedEffects).map((facet) => {
      const seen = this.observationDigests.get(facet.facetId) ?? new Set<string>()
      const changed = !seen.has(outputDigest)
      seen.add(outputDigest)
      this.observationDigests.set(facet.facetId, seen)
      if (!changed || observedEffects.length === 0) {
        record.noChangeCount += 1
        return this.progressFacet({
          facetId: facet.facetId, status: 'active', kind: 'no_change',
          summary: `${call.toolName} 没有产生新 revision、稳定引用或状态差异。`,
          evidence: [], executionFingerprint: signature,
        })
      }
      const submitted = definition?.semantics?.completionKind === 'submitted'
        || asRecord(observation.output)?.status === 'submitted'
      this.effectLedger.record(facet, observedEffects, outputDigest)
      const completed = !submitted && this.effectLedger.satisfied(facet)
      return this.progressFacet({
        facetId: facet.facetId,
        status: completed ? 'completed' : 'active',
        kind: submitted ? 'external_wait_started' : completed ? 'facet_completed' : 'verification_improved',
        summary: submitted
          ? `${call.toolName} 已进入有效外部等待或长任务状态。`
          : completed ? `${call.toolName} 已提供满足该 Facet 的结构化证据。` : '观察结果更接近完成条件。',
        evidence: [...evidence, ...observedEffects.flatMap((effect) => effect.evidence)]
          .slice(0, AGENT_FACET_EVIDENCE_LIMIT),
        executionFingerprint: signature,
      })
    })
  }

  private facetsForCall(
    call: ModelStepToolCall,
    resolvedEffects?: AgentObservedEffect[],
    includeTerminal = false
  ): AgentTaskFacet[] {
    const definition = this.registry.get(call.toolName)
    const effects = resolvedEffects ?? (definition?.capability?.control?.impacts ?? []).map((impact) => ({
      effect: impact.effect,
      entityTypes: impact.entityTypes,
      propertyIds: impact.propertyIds,
      targetRefs: [],
      count: 1,
      verified: false,
      evidence: [],
    }))
    const matches = resolvedEffects ? effectMatches : potentialEffectMatches
    const matching = [...this.facets.values()].filter((facet) => (
      (includeTerminal || !isTerminal(facet.status))
      && facet.requiredEffects.some((required) => effects.some((effect) => (
        matches(required, effect)
        || (
           required.verificationRequired
           && this.effectLedger.count(required.effectId) >= required.minimumCount
           && (!resolvedEffects || effect.verified)
           && overlapsForVerification(required, effect)
        )
      )))
    ))
    /*
     * 依赖只用来排优先级，不用来硬拒工具。
     *
     * 旧实现把"依赖全部 completed"当成过滤条件，于是一个带 verificationRequired 的前置 Facet
     * 只要还差一次验证观察，它下游的导航/写入就全部报 ACTION_PLAN_REQUIRED——而错误文案还把
     * 模型引向 declare_action_plan，白白多烧两轮。真正该拦的是"effect 压根匹配不上任何 Facet"，
     * 依赖顺序交给 settlement 与前沿提示去引导。
     */
    const ready = matching.filter((facet) => facet.dependsOn.every(
      (dependency) => this.facets.get(dependency)?.status === 'completed'
    ))
    const candidates = ready.length > 0 ? ready : matching
    if (candidates.length === 0) return []
    /*
     * 纯观察可以同时验证多个 Facet，写入不行。
     *
     * "只取第一个候选"是为了防止一次写入被多个 Facet 重复计数——但观察不是写入。一次
     * observe_camera_stage_scene 返回的是整个场景（对象、轨迹、关键帧全在里面），它本来就同时
     * 构成多个 Facet 的验证证据。实测那次观察只记给了 camera_scene，camera_object_animation
     * 拿不到验证证据，明明关键帧已经落库却永远停在 active。
     */
    if (effects.length > 0 && effects.every((effect) => effect.effect === 'observe')) {
      return candidates
    }
    const parallel = candidates.filter((facet) => facet.parallelizable)
    return parallel.length === candidates.length ? parallel : [candidates[0]]
  }

  private progressFacet(progress: AgentFacetProgress): AgentFacetProgress {
    const parsed = agentFacetProgressSchema.parse(progress)
    const facet = this.facets.get(parsed.facetId)
    if (facet) this.facets.set(parsed.facetId, {
      ...facet,
      status: parsed.status,
      statusReason: parsed.blocker ?? parsed.summary,
      evidence: [...facet.evidence, ...parsed.evidence].slice(-12),
    })
    return parsed
  }

  private blockFacet(
    facetId: string,
    kind: AgentFacetProgress['kind'],
    reason: string,
    fingerprint: string
  ): AgentFacetProgress {
    const event = this.progressFacet({
      facetId, status: 'blocked', kind, summary: reason,
      evidence: [fingerprint], executionFingerprint: fingerprint, blocker: reason,
    })
    const blockedDependencies = [facetId]
    for (let index = 0; index < blockedDependencies.length; index += 1) {
      const blockedFacetId = blockedDependencies[index]
      if (!blockedFacetId) continue
      for (const dependent of this.facets.values()) {
        if (!dependent.dependsOn.includes(blockedFacetId) || isTerminal(dependent.status)) continue
        blockedDependencies.push(dependent.facetId)
        this.pendingEvents.push(this.progressFacet({
          facetId: dependent.facetId,
          status: 'blocked',
          kind: 'capability_missing',
          summary: `依赖 Facet ${blockedFacetId} 已受阻。`,
          evidence: [`dependency:${blockedFacetId}`],
          blocker: `前置 Facet ${blockedFacetId} 未完成，无法安全继续。`,
        }))
      }
    }
    return event
  }
}
