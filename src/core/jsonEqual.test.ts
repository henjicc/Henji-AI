import { expect, it } from 'vitest'
import { jsonEqual } from './jsonEqual'

it('只比较 JSON 自有字段，键序和省略的 undefined 不产生变化', () => {
  expect(jsonEqual({ a: 1, b: { c: 2 }, omitted: undefined }, { b: { c: 2 }, a: 1 })).toBe(true)
  expect(jsonEqual(JSON.parse('{"__proto__":{}}'), { other: 1 })).toBe(false)
  expect(jsonEqual(JSON.parse('{"__proto__":{}}'), JSON.parse('{"__proto__":{}}'))).toBe(true)
})
