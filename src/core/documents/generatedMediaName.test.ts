import { expect, it } from 'vitest'
import { generatedMediaName } from './generatedMediaName'

it('自动产物名规范空白、使用回退并受所有工作区名称预算约束', () => {
  expect(generatedMediaName('  海报\n  夜景 ')).toBe('海报 夜景')
  expect(generatedMediaName(' ', '图片')).toBe('图片')
  expect(generatedMediaName('画'.repeat(450))).toBe(`${'画'.repeat(79)}…`)
  expect(generatedMediaName('画'.repeat(450), '图片', 500).length).toBe(120)
})

it('预算沿UTF-16长度，代理对、组合字符和ZWJ字素不可被截开', () => {
  for (const cluster of ['😀', 'e\u0301', '👨‍👩‍👧‍👦']) {
    const result = generatedMediaName(`a${cluster.repeat(40)}`, '图片', 20)
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result).toMatch(/…$/u)
    expect(result.slice(1, -1)).toBe(cluster.repeat((result.length - 2) / cluster.length))
  }
})
