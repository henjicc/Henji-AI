import type { ApplicationReflectionRegistry } from '../registry'
import type {
  ApplicationEvidence,
  ApplicationVerificationCondition,
  ApplicationVerificationResult,
} from '../transactions'
import type { JsonValue } from '../identifiers'
import type { ApplicationCustomVerifier, ApplicationExecutionContext } from './types'
import { isHexColorSchema, propertySchemaAtPath } from '../registry/propertyValidationErrors'

function jsonEqual(left: JsonValue | undefined, right: JsonValue, schema?: unknown): boolean {
  if (left === right) return true
  // 只容忍双精度运算的末位误差；不把业务精度或任意字符串视为等价。
  if (typeof left === 'number' && typeof right === 'number') return !(Number.isInteger(left) && Number.isInteger(right))
    && Math.abs(left - right) <= Number.EPSILON * 8 * Math.max(Math.abs(left), Math.abs(right))
  if (typeof left === 'string' && typeof right === 'string' && isHexColorSchema(schema)) return left.toLowerCase() === right.toLowerCase()
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => jsonEqual(value, right[index], propertySchemaAtPath(schema, [index])))
  }
  if (left && right && typeof left === 'object' && typeof right === 'object'
    && !Array.isArray(left) && !Array.isArray(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key], propertySchemaAtPath(schema, [key])))
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
        const propertyIds = condition.kind === 'property_equals'
          ? [(this.registry.getProperty(condition.propertyId) ?? this.registry.getProperty(`${condition.target.kind}.${condition.propertyId}`))?.id ?? condition.propertyId] : undefined
        const snapshot = await this.registry.readEntity(condition.target, propertyIds, context)
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
        const property = this.registry.getProperty(condition.propertyId) ?? this.registry.getProperty(`${condition.target.kind}.${condition.propertyId}`)
        if (!property) throw new Error('PROPERTY_NOT_FOUND')
        const actual = snapshot.properties[property.id]
        // 旧账本保存的是调用方原值；每次核对都用正式属性 schema 补默认值/规范化。
        const expected = this.registry.validatePropertyValueShape(property.entityType, property.id, condition.expected, context)
        const schema = property.value.kind === 'json' ? this.registry.resolveSchema(property.value.schemaRef, context)
          : property.value.kind === 'color' && property.value.format === 'hex' ? { 'x-value-format': 'hex-color' } : undefined
        const unordered = property.valueComparison === 'unordered_set'
        const matches = unordered && Array.isArray(actual) && Array.isArray(expected)
          ? actual.every(value => expected.some(item => jsonEqual(value, item, propertySchemaAtPath(schema, [0]))))
            && expected.every(item => actual.some(value => jsonEqual(value, item, propertySchemaAtPath(schema, [0]))))
          : jsonEqual(actual, expected, schema)
        if (!matches) {
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
          const message = error instanceof Error ? error.message : String(error)
          if (/(?:^|[_:])NOT_FOUND(?:[:：]|$)|ENTITY_NOT_FOUND/i.test(message)) {
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
