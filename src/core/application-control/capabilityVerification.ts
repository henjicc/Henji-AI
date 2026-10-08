import type { ApplicationCapabilityDefinition } from './applicationCapabilities'
import { isMutatingEffect } from './observedEffect'

/** 在领域输出校验之后生成公共操作信封；领域的效果回执是唯一证据源。 */
export function capabilityVerificationEnvelope(definition: ApplicationCapabilityDefinition, input: unknown, output: Record<string, unknown>): Record<string, unknown> {
  if (definition.readOnly || output.verification !== undefined || definition.verificationContract?.kind !== 'effect_receipt' || !definition.resolveObservedEffects) return output
  const effects = definition.resolveObservedEffects(input, output).filter(isMutatingEffect)
  // 明确允许没有写入的能力，仍须由领域回读正式状态确认；例如文本未匹配到范围。
  const verifiedNoChange = effects.length === 0 && definition.verificationContract.requireEffects === false && output.verified === true
  return { ...output, verification: {
    verified: verifiedNoChange || effects.length > 0 && effects.every(effect => effect.verified && effect.evidence.length > 0),
    condition: effects.flatMap(effect => effect.evidence).join('；') || (verifiedNoChange ? '该能力允许未产生写入，领域已回读正式状态确认。' : '未取得正式状态源的写入核对证据。'),
  } }
}
