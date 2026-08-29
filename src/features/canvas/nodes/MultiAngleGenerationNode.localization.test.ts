import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('MultiAngleGenerationNode localization', () => {
  it('用户可见字符串不直接写入中文，统一经翻译键渲染', () => {
    const source = readFileSync(new URL('./MultiAngleGenerationNode.tsx', import.meta.url), 'utf8')
    const stringLiteralLines = source.split('\n').filter((line) => (
      /['"`][^'"`]*[\u3400-\u9fff]/u.test(line)
      && !line.trimStart().startsWith('//')
    ))

    expect(stringLiteralLines).toEqual([])
  })
})
