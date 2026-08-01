import type { ApplicationReflectionRegistry } from '../registry'
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
    now: Date
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
      } catch {
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
