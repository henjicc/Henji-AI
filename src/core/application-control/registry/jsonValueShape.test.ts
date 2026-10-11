import { describe, expect, it } from 'vitest'
import { describeJsonValueShape, validateJsonValueShape } from './jsonValueShape'
import type { JsonValue } from '../identifiers'

describe('JSON 属性值形状与校验', () => {
  const rate = { type: 'object', properties: { numerator: { type: 'integer', minimum: 1 }, denominator: { type: 'integer', minimum: 1 } }, required: ['numerator', 'denominator'], additionalProperties: false }

  it('从正式 schema 描述对象，错误点名属性及期望键；合法值继续执行', () => {
    expect(describeJsonValueShape(rate)).toBe('{numerator: integer, denominator: integer}')
    expect(() => validateJsonValueShape('video_edit.sequence.frame_rate', rate, 60)).toThrow(/video_edit\.sequence\.frame_rate.*numerator.*denominator/)
    expect(() => validateJsonValueShape('video_edit.sequence.frame_rate', rate, { numerator: 60, denominator: 0 })).toThrow(/denominator/)
    expect(() => validateJsonValueShape('video_edit.sequence.frame_rate', rate, { numerator: 60, denominator: 1 })).not.toThrow()
  })

  it('数组、可空联合与嵌套对象共用校验，不把 JSON 属性当任意值', () => {
    const schema: JsonValue = { anyOf: [{ type: 'null' }, { type: 'array', items: rate }] }
    expect(describeJsonValueShape(schema)).toContain('null | {numerator: integer, denominator: integer}[]')
    expect(() => validateJsonValueShape('sample.frames', schema, null)).not.toThrow()
    expect(() => validateJsonValueShape('sample.frames', schema, [{ numerator: 30, denominator: 1 }])).not.toThrow()
    expect(() => validateJsonValueShape('sample.frames', schema, [30])).toThrow(/sample.frames/)
  })
})
