import { expect, it } from 'vitest'
import { z } from 'zod'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from './builtinApplicationCapabilityRegistry'
import { analyzeVideoEditBeatsCapability } from './domains/videoEdit/videoEditBeatCapability'
import { capabilityVerificationEnvelope } from './capabilityVerification'
import { VIDEO_EDIT_TEXT_CAPABILITIES } from './domains/videoEdit/videoEditTextCapabilities'
import { prepareVideoEditSubtitleCapability } from './domains/videoEdit/videoEditSubtitleCapabilities'

const input = { documentRef: { kind: 'video_edit.document', id: 'doc' }, sequenceRef: { kind: 'video_edit.sequence', id: 'doc:seq' }, frame: 12 }
const output = { resultRef: input.documentRef, markerRefs: [{ kind: 'video_edit.marker', id: 'doc:marker' }], message: '已保存', verified: true }
it('字幕准备的 execute/create 共用证据只出现一次，不丢失不同证据', () => {
  const prepared = { documentRef: input.documentRef, audioDocumentRef: { kind: 'audio_edit.document', id: 'audio' }, message: '声音已准备', verified: true }
  expect(capabilityVerificationEnvelope(prepareVideoEditSubtitleCapability, input, prepared)).toMatchObject({
    verification: { verified: true, condition: '已保存混音口播文档，可按引用续查识别。' },
  })
  expect(capabilityVerificationEnvelope(analyzeVideoEditBeatsCapability, input, output)).toMatchObject({
    verification: { condition: '已从保存后的剪辑核对节拍标记。' },
  })
})
it('D1：领域 verified 经已声明效果回执桥接；没有写入、证据或验证不能成为成功终态', () => {
  expect(capabilityVerificationEnvelope(analyzeVideoEditBeatsCapability, input, output)).toMatchObject({ verification: { verified: true } })
  expect(capabilityVerificationEnvelope(analyzeVideoEditBeatsCapability, input, { ...output, verified: false })).toMatchObject({ verification: { verified: false } })
  expect(capabilityVerificationEnvelope({ ...analyzeVideoEditBeatsCapability, resolveObservedEffects: () => [] }, input, output)).toMatchObject({ verification: { verified: false } })
  expect(capabilityVerificationEnvelope({ ...analyzeVideoEditBeatsCapability, resolveObservedEffects: () => [{ effect: 'update', entityTypes: ['video_edit.document'], propertyIds: [], targetRefs: [input.documentRef], count: 1, verified: true, evidence: [] }] }, input, output)).toMatchObject({ verification: { verified: false } })
  const explicit = { ...output, verification: { verified: false, condition: '保存核对失败' } }
  expect(capabilityVerificationEnvelope(analyzeVideoEditBeatsCapability, input, explicit)).toBe(explicit)
  const noChange = { documentRef: input.documentRef, resultRef: input.sequenceRef, ranges: [], changed: false, verified: true, message: '没有匹配范围' }
  expect(capabilityVerificationEnvelope(VIDEO_EDIT_TEXT_CAPABILITIES[0], input, noChange)).toMatchObject({ verification: { verified: true } })
  expect(capabilityVerificationEnvelope(VIDEO_EDIT_TEXT_CAPABILITIES[0], input, { ...noChange, verified: false })).toMatchObject({ verification: { verified: false } })
})
it('同源审查：所有直接返回 verified 的写能力必须有可执行效果回执，公共桥接覆盖整个注册表', () => {
  const definitions = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().filter(definition => !definition.readOnly && Boolean(z.toJSONSchema(definition.outputSchema, { io: 'output' }).properties?.verified))
  expect(definitions.map(definition => definition.id)).toContain('analyze_video_edit_beats')
  for (const definition of definitions) {
    expect(definition.verificationContract?.kind, definition.id).toBe('effect_receipt')
    expect(definition.resolveObservedEffects, definition.id).toBeTypeOf('function')
  }
})
