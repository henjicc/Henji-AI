import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { toGatewayError } from './gateway-support'

/*
 * 回归：INVALID_INPUT 不带任何定位信息，模型只能盲猜。
 *
 * 实测一次 canvas 运行里 read_agent_artifact 连续 11 次 INVALID_INPUT，每次 durationMs 都是 0
 * ——说明卡在入参校验、根本没进执行。模型改一个字段试一次，直到 CONSECUTIVE_FAILURES 把整次
 * 运行判死（25 轮 0 Effect）。旧文案只有一句"工具参数或结果未通过 schema 校验"。
 */
const artifactReadSchema = z.object({
  artifactRef: z.string().min(1),
  cursor: z.string().min(1).optional(),
  fields: z.array(z.string().min(1)).min(1).optional(),
}).strict()

function invalidInputMessage(input: unknown): string {
  const parsed = artifactReadSchema.safeParse(input)
  expect(parsed.success, '这些用例必须真的校验失败').toBe(false)
  const error = toGatewayError(parsed.success ? new Error('unreachable') : parsed.error)
  expect(error.code).toBe('INVALID_INPUT')
  return error.message
}

describe('INVALID_INPUT 必须能让模型自我修正', () => {
  // .strict() 下多传一个键是最常见的错法，消息必须点名是哪个键。
  it('多传字段时列出不被接受的键名', () => {
    const message = invalidInputMessage({ artifactRef: 'artifact:a', offset: 0, page: 2 })
    expect(message).toContain('offset')
    expect(message).toContain('page')
  })

  it('必填项缺失时指到具体字段', () => {
    expect(invalidInputMessage({ cursor: 'v1:0:abc' })).toContain('artifactRef')
  })

  it('类型或取值不合法时指到具体字段', () => {
    expect(invalidInputMessage({ artifactRef: 'artifact:a', fields: [] })).toContain('fields')
  })

  // 问题很多时截断，但要如实说明还有多少处，不能让模型以为已经改全了。
  it('问题过多时说明还有多少处未列出', () => {
    const wide = z.object({
      a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string(), f: z.string(),
    }).strict()
    const parsed = wide.safeParse({})
    const message = toGatewayError(parsed.success ? new Error('x') : parsed.error).message
    expect(message).toContain('另有')
  })

  it('非 zod 错误不受影响', () => {
    expect(toGatewayError(new Error('TIMEOUT')).code).toBe('TIMEOUT')
  })
})
