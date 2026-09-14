import { describe, expect, it } from 'vitest'
import { normalizeApplicationPropertyValue } from './valueValidation'

describe('通用属性文本保真', () => {
  const descriptor = { id: 'sample.content', nullable: false, value: { kind: 'string' as const, maxLength: 64 } }

  it.each(['镜头：转身，停下。', 'ＡＢＣ　① ﬁ ²', '  第一行\n\t第二行  ', 'e\u0301'])('原样保留 %s', (text) => {
    expect(normalizeApplicationPropertyValue(descriptor, text)).toBe(text)
  })

  it('按原始文本长度校验，不通过 Unicode 转换改变限制', () => {
    expect(normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'string', maxLength: 1 } }, 'ﬁ')).toBe('ﬁ')
    expect(() => normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'string', maxLength: 1 } }, 'e\u0301')).toThrow('STRING_TOO_LONG')
    expect(() => normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'string', minLength: 1 } }, '')).toThrow('STRING_TOO_SHORT')
  })

  it('枚举和引用仍要求原始的合法标识', () => {
    expect(() => normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'enum', values: [{ value: 'A', label: 'A' }] } }, 'Ａ')).toThrow('UNKNOWN_ENUM_VALUE')
    const ref = { kind: 'sample.item', id: '原始：Ａ' }
    expect(normalizeApplicationPropertyValue({ ...descriptor, value: { kind: 'ref', refKinds: ['sample.item'] } }, ref)).toEqual(ref)
  })
})
