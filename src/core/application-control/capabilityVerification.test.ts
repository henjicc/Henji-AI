import { expect, it } from 'vitest'
import { z } from 'zod'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from './builtinApplicationCapabilityRegistry'
import { applyTitleTemplateCapability } from './domains/videoEdit/videoEditTitleTemplateCapabilities'
import { capabilityVerificationEnvelope } from './capabilityVerification'
import { VIDEO_EDIT_TEXT_CAPABILITIES } from './domains/videoEdit/videoEditTextCapabilities'

const input = { documentRef: { kind: 'video_edit.document', id: 'doc' }, sequenceRef: { kind: 'video_edit.sequence', id: 'doc:seq' }, frame: 12, templateRef: { kind: 'video_edit.title_template', id: 'title:chapter' } }
const output = { resultRef: input.documentRef, clipRefs: [{ kind: 'video_edit.clip', id: 'doc:clip' }], message: '已保存', verified: true }
it('D1：领域 verified 经已声明效果回执桥接；没有写入、证据或验证不能成为成功终态', () => {
  expect(capabilityVerificationEnvelope(applyTitleTemplateCapability, input, output)).toMatchObject({ verification: { verified: true } })
  expect(capabilityVerificationEnvelope(applyTitleTemplateCapability, input, { ...output, verified: false })).toMatchObject({ verification: { verified: false } })
  expect(capabilityVerificationEnvelope({ ...applyTitleTemplateCapability, resolveObservedEffects: () => [] }, input, output)).toMatchObject({ verification: { verified: false } })
  expect(capabilityVerificationEnvelope({ ...applyTitleTemplateCapability, resolveObservedEffects: () => [{ effect: 'update', entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [input.documentRef], count: 1, verified: true, evidence: [] }] }, input, output)).toMatchObject({ verification: { verified: false } })
  const explicit = { ...output, verification: { verified: false, condition: '保存核对失败' } }
  expect(capabilityVerificationEnvelope(applyTitleTemplateCapability, input, explicit)).toBe(explicit)
  const noChange = { documentRef: input.documentRef, resultRef: input.sequenceRef, ranges: [], changed: false, verified: true, message: '没有匹配范围' }
  expect(capabilityVerificationEnvelope(VIDEO_EDIT_TEXT_CAPABILITIES[0], input, noChange)).toMatchObject({ verification: { verified: true } })
  expect(capabilityVerificationEnvelope(VIDEO_EDIT_TEXT_CAPABILITIES[0], input, { ...noChange, verified: false })).toMatchObject({ verification: { verified: false } })
})
it('同源审查：所有直接返回 verified 的写能力必须有可执行效果回执，公共桥接覆盖整个注册表', () => {
  const definitions = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().filter(definition => !definition.readOnly && Boolean(z.toJSONSchema(definition.outputSchema, { io: 'output' }).properties?.verified))
  expect(definitions.map(definition => definition.id)).toContain('apply_video_edit_title_template')
  for (const definition of definitions) {
    expect(definition.verificationContract?.kind, definition.id).toBe('effect_receipt')
    expect(definition.resolveObservedEffects, definition.id).toBeTypeOf('function')
  }
})
