import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import { AGENT_FACET_EVIDENCE_LIMIT } from '../../../../../src/core/assistant/progress'
import {
  agentObservedEffectSchema,
  type AgentObservedEffect,
  type AgentTaskFacet,
  type AgentTaskGraph,
  type AgentTaskRequiredEffect,
} from '../../../../../src/core/assistant/taskGraph'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import { createMainLogger } from '../../logging'
import type { AgentToolRegistry } from '../tools/registry'
import { digestJson } from '../tools/security'
import {
  extractResultReferences,
  extractResultScopeRevisions,
  failureEnvelope,
} from './runner-results'

const logger = createMainLogger('main.agent_runtime')

export interface CallRecord {
  attempts: number
  failureCount: number
  noChangeCount: number
  lastErrorCode: string | null
  succeededWrite: boolean
}

export interface ObservationFailure {
  code: string
  message: string
  retryable: boolean
  recovery: string
}

interface EffectLedgerEntry {
  count: number
  verificationCount: number
  verified: boolean
  evidenceDigests: Set<string>
  evidence: string[]
}

interface RecordedEffectObservation {
  outputDigest: string
  effects: AgentObservedEffect[]
}

export interface RestoredEffectLedgerEntry {
  effectId: string
  count: number
  verificationCount?: number
  verified: boolean
  evidenceDigests: string[]
  evidence: string[]
}

export interface EffectLedgerSnapshotEntry extends RestoredEffectLedgerEntry {
  verificationCount: number
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function observationFailure(
  observation: AgentToolObservation
): ObservationFailure | null {
  const failure = failureEnvelope(observation.output)
  if (!failure) return null
  return {
    code: failure.code,
    message: failure.message ?? observation.summary,
    retryable: failure.retryable ?? false,
    recovery: failure.recovery ?? 'none',
  }
}

export function stableEvidence(observation: AgentToolObservation): string[] {
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
  ].slice(0, AGENT_FACET_EVIDENCE_LIMIT)
}

export function callSignature(
  call: ModelStepToolCall,
  expectedRevisions: Partial<HostScopeRevisions>
): string {
  return `${call.toolName}:${digestJson({ input: call.input, expectedRevisions })}`
}

export function isTerminal(status: AgentTaskFacet['status']): boolean {
  return status === 'completed' || status === 'blocked'
    || status === 'waiting_user' || status === 'superseded'
}

export function effectMatches(
  required: AgentTaskRequiredEffect,
  observed: AgentObservedEffect
): boolean {
  if (required.effect !== observed.effect) return false
  if (required.entityTypes.length > 0
    && !required.entityTypes.some((entityType) => observed.entityTypes.includes(entityType))) return false
  if (required.propertyIds.length > 0
    && !required.propertyIds.every((propertyId) => observed.propertyIds.includes(propertyId))) return false
  return required.targetRefs.every((target) => observed.targetRefs.some(
    (candidate) => candidate.kind === target.kind && candidate.id === target.id
  ))
}

export function potentialEffectMatches(
  required: AgentTaskRequiredEffect,
  observed: AgentObservedEffect
): boolean {
  if (required.effect !== observed.effect) return false
  if (required.entityTypes.length > 0 && observed.entityTypes.length > 0
    && !required.entityTypes.some((entityType) => observed.entityTypes.includes(entityType))) return false
  if (required.propertyIds.length > 0 && observed.propertyIds.length > 0
    && !required.propertyIds.every((propertyId) => observed.propertyIds.includes(propertyId))) return false
  return true
}

export function overlapsForVerification(
  required: AgentTaskRequiredEffect,
  observed: AgentObservedEffect
): boolean {
  if (observed.effect !== 'observe') return false
  if (required.entityTypes.length > 0
    && !required.entityTypes.some((entityType) => observed.entityTypes.includes(entityType))) return false
  if (required.propertyIds.length > 0
    && !required.propertyIds.every((propertyId) => observed.propertyIds.includes(propertyId))) return false
  return required.targetRefs.every((target) => observed.targetRefs.some(
    (candidate) => candidate.kind === target.kind && candidate.id === target.id
  ))
}

export function resolveObservedEffects(
  registry: AgentToolRegistry,
  call: ModelStepToolCall,
  observation: AgentToolObservation,
  evidence: string[]
): AgentObservedEffect[] {
  if ((observation.effects?.length ?? 0) > 0) return observation.effects ?? []
  const definition = registry.get(call.toolName)
  if (!definition) return []
  const custom = definition.resolveObservedEffects
    ?? definition.capability?.resolveObservedEffects
  if (custom) {
    try {
      return (custom(call.input, observation.output) ?? []).flatMap((effect) => {
        const parsed = agentObservedEffectSchema.safeParse(effect)
        return parsed.success ? [parsed.data] : []
      })
    } catch (error) {
      logger.warn('能力 Effect 解析器执行失败', {
        event: 'agent_task_graph.effect_resolver.failed',
        context: {
          toolName: call.toolName,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      return []
    }
  }
  return []
}

export class AgentEffectLedger {
  private entries = new Map<string, EffectLedgerEntry>()
  /**
   * Action Plan 允许在拿到稳定引用后收窄 targetRefs。收窄不能抹掉此前已经发生的事实，
   * 因此保留每个 Facet 的强类型 Effect Receipt，并在契约变化时重新对账。
   */
  private readonly observationsByFacet = new Map<string, Map<string, RecordedEffectObservation>>()

  constructor(taskGraph: AgentTaskGraph, restored: RestoredEffectLedgerEntry[] = []) {
    for (const facet of taskGraph.facets) {
      for (const effect of facet.requiredEffects) {
        const entry = restored.find((candidate) => candidate.effectId === effect.effectId)
        this.entries.set(effect.effectId, this.createEntry(effect, entry))
      }
    }
  }

  rebuild(taskGraph: AgentTaskGraph, resetFacetIds: Set<string>): void {
    const previous = this.entries
    this.entries = new Map()
    for (const facet of taskGraph.facets) {
      for (const effect of facet.requiredEffects) {
        const retained = resetFacetIds.has(facet.facetId) ? undefined : previous.get(effect.effectId)
        this.entries.set(effect.effectId, this.createEntry(effect, retained && {
          effectId: effect.effectId,
          count: retained.count,
          verificationCount: retained.verificationCount,
          verified: retained.verified,
          evidenceDigests: [...retained.evidenceDigests],
          evidence: retained.evidence,
        }))
      }
      if (resetFacetIds.has(facet.facetId)) {
        for (const observation of this.observationsByFacet.get(facet.facetId)?.values() ?? []) {
          this.apply(facet, observation.effects, observation.outputDigest)
        }
      }
    }
  }

  snapshot(): EffectLedgerSnapshotEntry[] {
    return [...this.entries.entries()].map(([effectId, entry]) => ({
      effectId,
      count: entry.count,
      verificationCount: entry.verificationCount,
      verified: entry.verified,
      evidenceDigests: [...entry.evidenceDigests],
      evidence: [...entry.evidence],
    }))
  }

  count(effectId: string): number {
    return this.entries.get(effectId)?.count ?? 0
  }

  record(facet: AgentTaskFacet, observedEffects: AgentObservedEffect[], outputDigest: string): void {
    const observations = this.observationsByFacet.get(facet.facetId)
      ?? new Map<string, RecordedEffectObservation>()
    const observationKey = digestJson({ outputDigest, observedEffects })
    observations.set(observationKey, { outputDigest, effects: observedEffects })
    this.observationsByFacet.set(facet.facetId, observations)
    this.apply(facet, observedEffects, outputDigest)
  }

  private apply(facet: AgentTaskFacet, observedEffects: AgentObservedEffect[], outputDigest: string): void {
    for (const required of facet.requiredEffects) {
      const ledger = this.entries.get(required.effectId)
      if (!ledger) continue
      for (const observed of observedEffects) {
        if (effectMatches(required, observed)) {
          const evidenceDigest = digestJson({ kind: 'effect', outputDigest, effect: observed })
          if (!ledger.evidenceDigests.has(evidenceDigest)) {
            ledger.evidenceDigests.add(evidenceDigest)
            ledger.count = Math.min(required.minimumCount, ledger.count + observed.count)
            ledger.evidence.push(...observed.evidence)
          }
          if (observed.verified) this.recordVerification(required, ledger, observed, outputDigest)
        }
        if (required.verificationRequired && ledger.count >= required.minimumCount
          && overlapsForVerification(required, observed)) {
          this.recordVerification(required, ledger, observed, outputDigest, true)
        }
      }
      ledger.verified = !required.verificationRequired
        || ledger.verificationCount >= required.minimumCount
      ledger.evidence = [...new Set(ledger.evidence)].slice(-AGENT_FACET_EVIDENCE_LIMIT)
    }
  }

  satisfied(facet: AgentTaskFacet): boolean {
    return facet.requiredEffects.length > 0 && facet.requiredEffects.every((effect) => {
      const ledger = this.entries.get(effect.effectId)
      return Boolean(ledger && ledger.count >= effect.minimumCount
        && (!effect.verificationRequired || ledger.verified))
    })
  }

  private createEntry(
    effect: AgentTaskRequiredEffect,
    restored?: RestoredEffectLedgerEntry
  ): EffectLedgerEntry {
    return {
      count: Math.min(effect.minimumCount, restored?.count ?? 0),
      verificationCount: Math.min(
        effect.minimumCount,
        restored?.verificationCount ?? (restored?.verified ? effect.minimumCount : 0)
      ),
      verified: !effect.verificationRequired || Boolean(restored?.verified),
      evidenceDigests: new Set(restored?.evidenceDigests ?? []),
      evidence: restored?.evidence ?? [],
    }
  }

  private recordVerification(
    required: AgentTaskRequiredEffect,
    ledger: EffectLedgerEntry,
    observed: AgentObservedEffect,
    outputDigest: string,
    structuredVerification = false
  ): void {
    const digest = digestJson({ kind: 'verification', outputDigest, effect: observed })
    if (ledger.evidenceDigests.has(digest)) return
    ledger.evidenceDigests.add(digest)
    /*
     * 一次覆盖到位的结构化观察就verify了整条 Effect，不是"验证一个实例算一次"。
     *
     * 旧实现按 observed.count 累加、要求攒够 minimumCount，于是"写 6 个关键帧"必须再读 6 次
     * 场景才算验证通过——而 observe_camera_stage_scene 一次就返回了全部关键帧，再读只会拿到
     * 同一份数据并被去重挡掉。实测 camera_object_animation 因此永远停在 active，整次运行明明
     * 已经把活干完，却报"任务图仍有 Facet 未结算"。
     *
     * 能走到这一步说明 overlapsForVerification 已经确认这次观察覆盖了所需实体与属性，
     * 且写入计数已经达标，直接判定为已验证。
     */
    ledger.verificationCount = structuredVerification
      ? required.minimumCount
      : Math.min(required.minimumCount, ledger.verificationCount + observed.count)
    if (structuredVerification) ledger.evidence.push(...observed.evidence)
  }
}
