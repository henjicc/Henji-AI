import { expect, it } from 'vitest'
import { codeTypeCheckAppendix, codeTypeCheckData, codeTypeCheckFact, type CodeTypeCheckReport, type CodeTypeDiagnostic } from './typeDiagnostics'

const diagnostic = (line: number, message = `第 ${line} 行的问题`): CodeTypeDiagnostic => ({ code: 2551, message, span: { file: 'main.ts', start: line, end: line + 3, startLine: line, startColumn: 5, endLine: line, endColumn: 8 } })
const checked = (count: number): Extract<CodeTypeCheckReport, { status: 'checked' }> => ({ status: 'checked', checkedFiles: ['main.ts'], diagnostics: Array.from({ length: Math.min(count, 50) }, (_, index) => diagnostic(index + 1)), total: count, elapsedMs: 3 })

it('证据说明是否通过、前几条位置与没有结论的原因，长列表留给 data', () => {
  expect(codeTypeCheckFact(checked(0))).toBe('类型检查通过：main.ts。')
  expect(codeTypeCheckFact({ status: 'checked', checkedFiles: [], diagnostics: [], total: 0, elapsedMs: 0 })).toBeUndefined()
  expect(codeTypeCheckFact({ status: 'unavailable', reason: '等待超过 8 秒' })).toBe('类型检查未完成（等待超过 8 秒），本次没有类型结论。')
  const fact = codeTypeCheckFact(checked(60))!
  expect(fact.split('\n')).toEqual(['类型检查发现 60 处问题（不阻止创建，画面照常试渲染；按位置修正后提交新源码版本）：', ...Array.from({ length: 6 }, (_, index) => `- main.ts:${index + 1}:5 TS2551 第 ${index + 1} 行的问题`), '其余 54 处见 data。'])
  const data = codeTypeCheckData(checked(60))
  expect(data).toMatchObject({ status: 'checked', total: 60 })
  expect(data.status === 'checked' && data.diagnostics).toHaveLength(20)
  expect(data.status === 'checked' && data.diagnostics[0]).toEqual({ file: 'main.ts', line: 1, column: 5, endLine: 1, endColumn: 8, code: 2551, message: '第 1 行的问题' })
  expect(codeTypeCheckFact({ ...checked(1), diagnostics: [diagnostic(1, 'x'.repeat(5000))] })!.length).toBeLessThanOrEqual(1000)
})

it('失败附注只在有类型错误时出现，多份源码标出第几份', () => {
  expect(codeTypeCheckAppendix([checked(0), { status: 'unavailable', reason: '超时' }, undefined])).toBe('')
  expect(codeTypeCheckAppendix([checked(1)])).toBe('\n类型检查同时发现 1 处问题，可能就是原因：\n- main.ts:1:5 TS2551 第 1 行的问题')
  expect(codeTypeCheckAppendix([checked(0), checked(7)], 2)).toBe('\n类型检查同时发现 7 处问题，可能就是原因：\n- 第 2 份源码 main.ts:1:5 TS2551 第 1 行的问题\n- 第 2 份源码 main.ts:2:5 TS2551 第 2 行的问题\n（另有 5 处未列出）')
})
