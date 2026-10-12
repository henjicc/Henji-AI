import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { normalizeApplicationPropertyValue } from './valueValidation'
import { propertyIssueMessage } from './propertyValidationErrors'

describe('属性数值错误保留声明范围', () => {
  const schema = z.object({ speed: z.number().min(1).max(10000) })
  it.each([0, 20000])('嵌套数值 %s 同时说明上下界、单位和实际值', speed => {
    const result = schema.safeParse({ speed })
    if (result.success) throw new Error('越界夹具不应通过')
    expect(propertyIssueMessage(result.error.issues[0], z.toJSONSchema(schema), { speed }, '速度（sample.speed）', '%'))
      .toBe(`速度（sample.speed）的 speed 应在 1 到 10000 % 之间，收到 ${speed}。`)
  })
  it.each([
    [z.number().min(1), 0, '至少 1'],
    [z.number().max(10), 11, '不能大于 10'],
    [z.number().gt(1).lt(10), 1, '必须大于 1'],
    [z.number().gt(1).lt(10), 10, '必须小于 10'],
  ] as const)('单边或开放边界不伪装成闭区间', (valueSchema, input, expected) => {
    const result = valueSchema.safeParse(input)
    if (result.success) throw new Error('越界夹具不应通过')
    expect(propertyIssueMessage(result.error.issues[0], z.toJSONSchema(valueSchema), input, '数值')).toBe(`数值${expected}，收到 ${input}。`)
  })
})

describe('通用属性文本保真', () => {
  const descriptor = { id: 'sample.content', nullable: false, value: { kind: 'string' as const, maxLength: 64 } }

  it.each(['镜头：转身，停下。', 'ＡＢＣ　① ﬁ ²', '  第一行\n\t第二行  ', 'e\u0301'])('原样保留 %s', (text) => {
    expect(normalizeApplicationPropertyValue(descriptor, text)).toBe(text)
  })

  it('按原始文本长度校验，不通过 Unicode 转换改变限制', () => {
    expect(normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'string', maxLength: 1 } }, 'ﬁ')).toBe('ﬁ')
    expect(() => normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'string', maxLength: 1 } }, 'e\u0301')).toThrow('长度最多')
    expect(() => normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'string', minLength: 1 } }, '')).toThrow('长度至少')
  })

  it('枚举和引用仍要求原始的合法标识', () => {
    expect(() => normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'enum', values: [{ value: 'A', label: 'A' }] } }, 'Ａ')).toThrow('只能取')
    const ref = { kind: 'sample.item', id: '原始：Ａ' }
    expect(normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'ref', refKinds: ['sample.item'] } }, ref)).toEqual(ref)
  })
})
