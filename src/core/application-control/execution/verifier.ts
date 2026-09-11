import type { ApplicationReflectionRegistry } from '../registry'
import { ApplicationEntityNotFoundError } from '../registry/types'
import type {
  ApplicationEvidence,
  ApplicationVerificationCondition,
  ApplicationVerificationResult,
} from '../transactions'
import type { JsonValue } from '../identifiers'
import type { ApplicationCustomVerifier, ApplicationExecutionContext } from './types'

function jsonEqual(left: JsonValue | undefined, right: JsonValue): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]))
  }
  if (left && right && typeof left === 'object' && typeof right === 'object'
    && !Array.isArray(left) && !Array.isArray(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]))
  }
  return false
}

export class ApplicationTransactionVerifier {
  private readonly customVerifiers = new Map<string, ApplicationCustomVerifier>()

  constructor(private readonly registry: ApplicationReflectionRegistry) {}

  register(verifier: ApplicationCustomVerifier): void {
    if (this.customVerifiers.has(verifier.id)) throw new Error(`VERIFIER_DUPLICATE:${verifier.id}`)
    this.customVerifiers.set(verifier.id, verifier)
  }

  async verify(
    conditions: ApplicationVerificationCondition[],
    executionEvidence: ApplicationEvidence[],
    context: ApplicationExecutionContext,
    now: Date,
    minimumRevisions: Record<string, number> = {},
  ): Promise<ApplicationVerificationResult> {
    const evidence: ApplicationEvidence[] = []
    const unmetConditions: string[] = []
    for (const condition of conditions) {
      if (condition.kind === 'custom') {
        const verifier = this.customVerifiers.get(condition.verifierId)
        if (!verifier) {
          unmetConditions.push(`验证器不存在：${condition.verifierId}`)
          continue
        }
        const result = await verifier.verify(condition.input, context)
        evidence.push(...result.evidence)
        unmetConditions.push(...result.unmetConditions)
        continue
      }
      if (condition.kind === 'evidence_fact') {
        const matched = executionEvidence.some((item) => item.fact === condition.fact)
        if (!matched) unmetConditions.push(`缺少执行证据：${condition.fact}`)
        else evidence.push(...executionEvidence.filter((item) => item.fact === condition.fact))
        continue
      }
      try {
        const propertyIds = condition.kind === 'property_equals' ? [condition.propertyId] : undefined
        const snapshot = await this.registry.readEntity(condition.target, propertyIds, context)
        if (snapshot.ref.kind !== condition.target.kind || snapshot.ref.id !== condition.target.id) {
          unmetConditions.push(`读取结果不属于验证目标：${condition.target.kind}/${condition.target.id}`)
          continue
        }
        const requiredScopes = new Set([
          ...(this.registry.getEntity(condition.target.kind)?.revisionScopes ?? []),
          ...(condition.kind === 'property_equals' ? this.registry.getProperty(condition.propertyId)?.revisionScopes ?? [] : []),
        ])
        if (!Number.isFinite(Date.parse(snapshot.capturedAt)) || Date.parse(snapshot.capturedAt) < now.getTime()
          || [...requiredScopes].some((scope) => snapshot.revisions[scope] === undefined || snapshot.revisions[scope] < (minimumRevisions[scope] ?? 0))
          || Object.entries(snapshot.revisions).some(([scope, revision]) => revision < (minimumRevisions[scope] ?? 0))
          || (condition.target.revision !== undefined && (snapshot.ref.revision === undefined || snapshot.ref.revision < condition.target.revision))) {
          unmetConditions.push(`读取结果早于本次验证或执行版本：${condition.target.kind}/${condition.target.id}`)
          continue
        }
        if (condition.kind === 'entity_absent') {
          unmetConditions.push(`目标实体仍然存在：${condition.target.kind}/${condition.target.id}`)
          continue
        }
        if (condition.kind === 'entity_exists') {
          evidence.push({
            kind: 'entity_state',
            target: snapshot.ref,
            fact: '目标实体存在。',
            capturedAt: now.toISOString(),
          })
          continue
        }
        const actual = snapshot.properties[condition.propertyId]
        if (!jsonEqual(actual, condition.expected)) {
          unmetConditions.push(`属性验证失败：${condition.propertyId}`)
        } else {
          evidence.push({
            kind: 'property_value',
            target: snapshot.ref,
            fact: `属性 ${condition.propertyId} 已达到预期值。`,
            data: actual,
            capturedAt: now.toISOString(),
          })
        }
      } catch (error) {
        if (condition.kind === 'entity_absent') {
          if (error instanceof ApplicationEntityNotFoundError
            && error.target.kind === condition.target.kind && error.target.id === condition.target.id) {
            evidence.push({
              kind: 'operation_result',
              target: condition.target,
              fact: '目标实体已不存在。',
              capturedAt: now.toISOString(),
            })
          } else {
            unmetConditions.push(`无法确认目标实体不存在：${condition.target.kind}/${condition.target.id}`)
          }
          continue
        }
        unmetConditions.push(`目标实体不可读取：${condition.target.kind}/${condition.target.id}`)
      }
    }
    return {
      verified: unmetConditions.length === 0,
      evidence,
      unmetConditions,
      checkedAt: now.toISOString(),
    }
  }
}
