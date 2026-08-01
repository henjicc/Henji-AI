import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import {
  agentFacetProgressSchema,
  agentProgressSettlementSchema,
  type AgentFacetProgress,
  type AgentProgressSettlement,
} from '../../../../../src/core/assistant/progress'
import type { AgentTaskFacet, AgentTaskGraph } from '../../../../../src/core/assistant/taskGraph'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentToolRegistry } from '../tools/registry'
import { digestJson } from '../tools/security'
import { extractResultReferences, extractResultScopeRevisions } from './runner-results'

interface CallRecord {
  attempts: number
  failureCount: number
  noChangeCount: number
  lastErrorCode: string | null
  succeededWrite: boolean
  discoveryReused: boolean
}

export interface AgentProgressGuardDecision {
  reason: string
  events: AgentFacetProgress[]
}

interface ObservationFailure {
  code: string
  message: string
  recovery: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function observationFailure(observation: AgentToolObservation): ObservationFailure | null {
  const output = asRecord(observation.output)
  if (output?.ok !== false) return null
  const error = asRecord(output.error)
  if (!error || typeof error.code !== 'string') return null
  return {
    code: error.code,
    message: typeof error.message === 'string' ? error.message : observation.summary,
    recovery: typeof error.recovery === 'string' ? error.recovery : 'none',
  }
}

function stableEvidence(observation: AgentToolObservation): string[] {
  const references = extractResultReferences(observation.output) ?? {}
  const revisions = extractResultScopeRevisions(observation.output) ?? {}
  const output = asRecord(observation.output)
  const directRevision = typeof output?.revision === 'number' ? [`revision:${output.revision}`] : []
  const status = typeof output?.status === 'string' ? [`status:${output.status}`] : []
  return [
    ...Object.entries(references).map(([key, value]) => `${key}:${value}`),
    ...Object.entries(revisions).map(([scope, revision]) => `${scope}@${revision}`),
    ...directRevision,
    ...status,
  ].slice(0, 12)
}

function callSignature(
  call: ModelStepToolCall,
  expectedRevisions: Partial<HostScopeRevisions>
): string {
  return `${call.toolName}:${digestJson({ input: call.input, expectedRevisions })}`
}

function isTerminal(status: AgentTaskFacet['status']): boolean {
  return status === 'completed' || status === 'blocked' || status === 'waiting_user'
}

export class AgentFacetProgressTracker {
  private readonly facets = new Map<string, AgentTaskFacet>()
  private readonly callRecords = new Map<string, CallRecord>()
  private readonly observationDigests = new Map<string, Set<string>>()
  private readonly discoveredSchemas = new Set<string>()
  private readonly schemaFacetIds = new Map<string, Set<string>>()
  private readonly pendingEvents: AgentFacetProgress[] = []

  constructor(
    taskGraph: AgentTaskGraph,
    private readonly registry: AgentToolRegistry
  ) {
    for (const facet of taskGraph.facets) this.facets.set(facet.facetId, { ...facet })
  }

  validate(
    call: ModelStepToolCall,
    expectedRevisions: Partial<HostScopeRevisions>
  ): AgentProgressGuardDecision | null {
    const settlement = this.settlement()
    if (settlement.status !== 'active') {
      return {
        reason: `任务图已结算为 ${settlement.status}，禁止继续调用工具；请输出结构化完成或受阻说明。`,
        events: [],
      }
    }
    const signature = callSignature(call, expectedRevisions)
    const record = this.callRecords.get(signature)
    if (!record) return null
    const definition = this.registry.get(call.toolName)
    let kind: AgentFacetProgress['kind'] | null = null
    let reason = ''
    if (record.succeededWrite && definition && !definition.readOnly) {
      kind = 'repeated_write'
      reason = `${call.toolName} 已在相同 base revision 和参数下成功，拒绝重复写入。`
    } else if (record.discoveryReused) {
      kind = 'repeated_discovery'
      reason = '相同批量发现已命中缓存且没有新 schema，拒绝继续搜索。'
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
      discoveryReused: false,
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
    return this.recordSuccess(input.call, input.observation, signature, record)
  }

  settlement(): AgentProgressSettlement {
    const facets = [...this.facets.values()]
    const completed = facets.filter((facet) => facet.status === 'completed')
    const blocked = facets.filter((facet) => facet.status === 'blocked')
    const waiting = facets.filter((facet) => facet.status === 'waiting_user')
    const remaining = facets.filter((facet) => !isTerminal(facet.status))
    const hasRunnableFacet = remaining.some((facet) => facet.dependsOn.every(
      (dependency) => this.facets.get(dependency)?.status === 'completed'
    ))
    const status: AgentProgressSettlement['status'] = remaining.length > 0 && hasRunnableFacet
      ? 'active'
      : remaining.length > 0 && waiting.length > 0
        ? 'waiting_user'
      : blocked.length === 0 && waiting.length === 0
        ? 'completed'
        : completed.length > 0
          ? 'partial'
          : waiting.length > 0 && blocked.length === 0 ? 'waiting_user' : 'blocked'
    return agentProgressSettlementSchema.parse({
      status,
      completedFacetIds: completed.map((facet) => facet.facetId),
      blockedFacets: blocked.map((facet) => ({
        facetId: facet.facetId,
        reason: facet.statusReason || '没有满足完成条件。',
      })),
      waitingFacetIds: waiting.map((facet) => facet.facetId),
      remainingFacetIds: remaining.map((facet) => facet.facetId),
      evidence: facets.flatMap((facet) => facet.evidence).slice(-24),
      summary: status === 'active'
        ? `任务图仍有 ${remaining.length} 个 Facet 未结算。`
        : `任务图结算为 ${status}：完成 ${completed.length}，受阻 ${blocked.length}，等待用户 ${waiting.length}。`,
      suggestedNextStep: waiting.length > 0
        ? '向用户提出一个最小且具体的问题，然后进入现有 waiting_user。'
        : blocked.length > 0
          ? '如实说明已完成部分、阻塞原因和继续所需的最小条件。'
          : null,
    })
  }

  settlementGuidance(): string | null {
    const settlement = this.settlement()
    if (settlement.status === 'active') return null
    return [
      '[任务图结构化结算]',
      JSON.stringify(settlement),
      settlement.status === 'waiting_user'
        ? '停止调用工具，只向用户提出一个最小具体问题。'
        : '停止调用工具；最终答复必须列出已完成部分、未完成部分、证据、阻塞原因和继续所需的最小动作。',
    ].join('\n')
  }

  resumeWaitingFacets(answer: string): AgentFacetProgress[] {
    for (const record of this.callRecords.values()) {
      if (record.succeededWrite || record.discoveryReused) continue
      record.failureCount = 0
      record.noChangeCount = 0
      record.lastErrorCode = null
    }
    const answerDigest = digestJson({ answer })
    return [...this.facets.values()].flatMap((facet) => facet.status === 'waiting_user'
      ? [this.progressFacet({
          facetId: facet.facetId,
          status: 'active',
          kind: 'user_input_received',
          summary: '已收到用户补充信息，继续原 Facet。',
          evidence: [`user_input:${answerDigest}`],
          executionFingerprint: answerDigest,
        })]
      : [])
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
    record.discoveryReused = false
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
      if (output?.reused === true && newDigests.length === 0) {
        events.push(this.blockFacet(
          facetId, 'repeated_discovery', '相同发现指纹只返回缓存，没有新 schema。', fingerprint
        ))
      } else {
        events.push(this.progressFacet({
          facetId,
          status: 'active',
          kind: 'schema_discovered',
          summary: '已一次取得该 Facet 的能力摘要和稳定 schemaRef。',
          evidence: [`discovery:${fingerprint}`, ...newDigests.slice(0, 4)],
          executionFingerprint: fingerprint,
        }))
      }
    }
    record.discoveryReused = output?.reused === true && !discoveredNewSchema
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
    return this.facetsForCall(call).map((facet) => {
      const seen = this.observationDigests.get(facet.facetId) ?? new Set<string>()
      const changed = !seen.has(outputDigest)
      seen.add(outputDigest)
      this.observationDigests.set(facet.facetId, seen)
      if (!changed || evidence.length === 0) {
        record.noChangeCount += 1
        return this.progressFacet({
          facetId: facet.facetId, status: 'active', kind: 'no_change',
          summary: `${call.toolName} 没有产生新 revision、稳定引用或状态差异。`,
          evidence: [], executionFingerprint: signature,
        })
      }
      const readFacet = facet.capabilityKinds.every((kind) => ['observe', 'query'].includes(kind))
      const navigation = definition?.category === 'navigation'
      const submitted = definition?.semantics?.completionKind === 'submitted'
        || asRecord(observation.output)?.status === 'submitted'
      const completed = navigation || readFacet || (definition && !definition.readOnly && !submitted)
      if (definition && !definition.readOnly) record.succeededWrite = true
      return this.progressFacet({
        facetId: facet.facetId,
        status: completed ? 'completed' : 'active',
        kind: submitted ? 'external_wait_started' : completed ? 'facet_completed' : 'verification_improved',
        summary: submitted
          ? `${call.toolName} 已进入有效外部等待或长任务状态。`
          : completed ? `${call.toolName} 已提供满足该 Facet 的结构化证据。` : '观察结果更接近完成条件。',
        evidence,
        executionFingerprint: signature,
      })
    })
  }

  private facetsForCall(call: ModelStepToolCall): AgentTaskFacet[] {
    const definition = this.registry.get(call.toolName)
    const domains = new Set([definition?.category, definition?.capability?.domain].filter(Boolean))
    const candidates = [...this.facets.values()].filter((facet) => (
      !isTerminal(facet.status)
      && domains.has(facet.domain)
      && facet.dependsOn.every((dependency) => this.facets.get(dependency)?.status === 'completed')
    ))
    if (candidates.length > 0) {
      const parallel = candidates.filter((facet) => facet.parallelizable)
      return parallel.length === candidates.length ? parallel : [candidates[0]]
    }
    return [...this.facets.values()].filter((facet) => (
      !isTerminal(facet.status)
      && facet.dependsOn.every((dependency) => this.facets.get(dependency)?.status === 'completed')
    )).slice(0, 1)
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
