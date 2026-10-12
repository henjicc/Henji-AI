import { applicationRefSchema, type ApplicationCapabilityDefinition } from './applicationCapabilities'
import { isMutatingEffect } from './observedEffect'
import { z } from 'zod'

function generatesVerification(definition: ApplicationCapabilityDefinition): boolean {
  return !definition.readOnly && definition.verificationContract?.kind === 'effect_receipt' && Boolean(definition.resolveObservedEffects)
}

/** 领域校验之后追加的公共回执也必须进入对外 schema；不改领域或持久格式。 */
export function capabilityPublicOutputSchema(definition: ApplicationCapabilityDefinition): z.ZodType {
  const schema = definition.outputSchema
  if (!generatesVerification(definition) || !(schema instanceof z.ZodObject) || schema.shape.verification) return schema
  return schema.extend({ verification: z.object({ verified: z.boolean(), condition: z.string(), target: applicationRefSchema.optional() }).strict() })
}

/** 在领域输出校验之后生成公共操作信封；领域的效果回执是唯一证据源。 */
export function capabilityVerificationEnvelope(definition: ApplicationCapabilityDefinition, input: unknown, output: Record<string, unknown>): Record<string, unknown> {
  if (!generatesVerification(definition) || output.verification !== undefined) return output
  const effects = definition.resolveObservedEffects!(input, output).filter(isMutatingEffect)
  // 明确允许没有写入的能力，仍须由领域回读正式状态确认；例如文本未匹配到范围。
  const verifiedNoChange = effects.length === 0 && definition.verificationContract?.requireEffects === false && output.verified === true
  return { ...output, verification: {
    verified: verifiedNoChange || effects.length > 0 && effects.every(effect => effect.verified && effect.evidence.length > 0),
    condition: [...new Set(effects.flatMap(effect => effect.evidence))].join('；') || (verifiedNoChange ? '该能力允许未产生写入，领域已回读正式状态确认。' : '未取得正式状态源的写入核对证据。'),
  } }
}
