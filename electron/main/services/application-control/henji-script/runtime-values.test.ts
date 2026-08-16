import { describe, expect, it } from 'vitest'

import { evaluate } from './runtime-values'

/*
 * 回归：取不到东西时只说「X 不存在」，不说实际有什么。
 *
 * 模型不知道该改成什么，于是重写整段脚本再试——实测 camera 场景因此把 run_henji_script 的
 * 5 次调用额度耗光，最终 0 个 Effect。这与 artifact 字段筛选、zod 校验消息是同一类问题：
 * 报了失败，没给能自纠的事实。
 */
function readVariable(
  values: Record<string, unknown>,
  name: string,
  path: readonly (string | number)[] = []
): unknown {
  return evaluate(
    { kind: 'variable', name, path } as never,
    new Map(Object.entries(values))
  )
}

describe('Henji Script 取值失败的消息', () => {
  it('对象缺字段时列出可用字段', () => {
    expect(() => readVariable({ r: { projectRef: 'a', revision: 2 } }, 'r', ['projectId']))
      .toThrow(/结果字段 projectId 不存在。可用字段：projectRef、revision/)
  })

  it('空对象如实说明没有字段', () => {
    expect(() => readVariable({ r: {} }, 'r', ['anything'])).toThrow(/当前对象没有任何字段/)
  })

  it('在数组上取字段时说明它是数组及长度', () => {
    expect(() => readVariable({ r: [1, 2, 3] }, 'r', ['id'])).toThrow(/当前是长度 3 的数组/)
  })

  it('在标量上继续取字段时说明类型', () => {
    expect(() => readVariable({ r: { count: 5 } }, 'r', ['count', 'nested'])).toThrow(/当前值是 number/)
    expect(() => readVariable({ r: { value: null } }, 'r', ['value', 'nested'])).toThrow(/当前值是 null/)
  })

  it('数组越界时也带上实际长度', () => {
    expect(() => readVariable({ r: { items: [1] } }, 'r', ['items', 3]))
      .toThrow(/数组下标 3 不存在。当前是长度 1 的数组/)
  })

  // 变量名写错和字段名写错是同一类错，消息也该同样可自纠。
  it('前序结果不存在时列出已有的', () => {
    expect(() => readVariable({ project: {}, scene: {} }, 'proj'))
      .toThrow(/前序结果 proj 不存在。已有前序结果：project、scene/)
  })

  it('一个前序结果都没有时如实说明', () => {
    expect(() => readVariable({}, 'anything')).toThrow(/当前还没有任何前序结果/)
  })

  it('路径正确时正常取值', () => {
    expect(readVariable({ r: { a: { b: [10, 20] } } }, 'r', ['a', 'b', 1])).toBe(20)
  })
})
