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

  constructor(
    initialTaskGraph: AgentTaskGraph,
    private readonly registry: AgentToolRegistry,
    requiresExplicitActionPlan = false,
    restoredLedger: RestoredEffectLedgerEntry[] = [],
    restoredLeaseFacetIds: string[] = []
  ) {
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
    return prepareDeclaredActionPlan({ declaration, taskGraph: this.taskGraph, facets: this.facets })
  }

  commitDeclaredActionPlan(prepared: Extract<PreparedDeclaredActionPlan, { ok: true }>): void {
    this.taskGraph = prepared.taskGraph
    this.requiresExplicitActionPlan = false
    this.facets.clear()
    for (const facet of prepared.taskGraph.facets) {
      this.facets.set(facet.facetId, { ...facet })
      if (prepared.declaredFacetIds.has(facet.facetId)) this.observationDigests.delete(facet.facetId)
    }
    this.effectLedger.rebuild(prepared.taskGraph, prepared.declaredFacetIds)
  }

  activeFacetIds(): string[] {
    return listActiveFacetIds([...this.facets.values()])
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
   * 现在：请求一律规范化为当前前沿；重复发现交给 no_change 计数做软刹车，不再硬失败。
   */
  normalizeCallInput(call: ModelStepToolCall): unknown | null {
    if (call.toolName !== 'discover_application_capabilities') return null
    const scope = listDiscoverableFacets([...this.facets.values()])
    if (scope.length === 0) return null
    const undiscovered = scope.filter((facet) => !this.discoveredFacetIds.has(facet.facetId))
    const targets = undiscovered.length > 0 ? undiscovered : scope
    const input = asRecord(call.input)
    const extraQueries: Record<string, string[]> = {}
    if (Array.isArray(input?.facets)) {
      for (const rawFacet of input.facets) {
        const facet = asRecord(rawFacet)
        if (typeof facet?.facetId !== 'string' || !Array.isArray(facet.queries)) continue
        extraQueries[facet.facetId] = facet.queries.filter(
          (query): query is string => typeof query === 'string' && query.length > 0
        )
      }
    }
    return buildCapabilityDiscoveryInputForFacets(targets, extraQueries)
  }

  validate(
    call: ModelStepToolCall,
    expectedRevisions: Partial<HostScopeRevisions>,
    allowSettledActionGroupSibling = false
  ): AgentProgressGuardDecision | null {
    const settlement = this.settlement()
    if (settlement.status !== 'active' && !allowSettledActionGroupSibling) {
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
          + '如果这个写入确实是任务的一部分，用 declare_action_plan 为对应 facetId 补声明该 Effect（只需 effect/entityTypes/minimumCount），否则改用匹配的能力。',
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
    return buildSettlementGuidance(this.settlement())
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
