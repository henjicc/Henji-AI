import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { redactToolInputForLog, toGatewayError } from './gateway-support'

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

  /*
   * zod 自己也有说不清的时候：`.refine()` 产出的 custom issue 默认消息就是干巴巴一句
   * "Invalid input"。实测生成场景第一次能力发现收到的原话是
   * 「queries：Invalid input；queries：Invalid input」，模型在推理里明说看不出哪里错，
   * 只能换写法蒙，白烧一个回合。讲不出原因时，至少要把模型实际传了什么摆出来。
   */
  it('zod 讲不出原因时报出实际收到的值', () => {
    const refined = z.object({
      queries: z.array(z.string()).refine(() => false),
    }).strict()
    const parsed = refined.safeParse({ queries: ['生成一张图片'] })
    const message = toGatewayError(
      parsed.success ? new Error('unreachable') : parsed.error,
      { queries: ['生成一张图片'] },
    ).message

    expect(message).toContain('实际收到')
    expect(message).toContain('生成一张图片')
  })

  it('字段压根没传时说清是"没传"而不是值有问题', () => {
    const refined = z.object({ queries: z.array(z.string()).optional() }).strict()
      .superRefine((value, context) => {
        if (!value.queries) {
          context.addIssue({ code: 'custom', path: ['queries'], message: 'Invalid input' })
        }
      })
    const parsed = refined.safeParse({})
    const message = toGatewayError(
      parsed.success ? new Error('unreachable') : parsed.error, {},
    ).message
    expect(message).toContain('实际没有传这个字段')
  })

  it('zod 已经说清楚的消息不再画蛇添足', () => {
    const message = invalidInputMessage({ cursor: 'v1:0:abc' })
    expect(message).not.toContain('实际收到')
  })

  it('非 zod 错误不受影响', () => {
    expect(toGatewayError(new Error('TIMEOUT')).code).toBe('TIMEOUT')
  })
})

describe('工具入参的日志投影', () => {
  /*
   * 「模型可见即可重建」：进入模型请求的东西必须能从日志还原。旧实现只记 errorCode，
   * 于是 11 次 INVALID_INPUT 只能证明"失败了 11 次"，查不出错在哪个字段。
   */
  it('保留键名——错的通常就是键名', () => {
    const projected = redactToolInputForLog({ artifactRef: 'artifact:a', offset: 3 }) as Record<string, unknown>
    expect(Object.keys(projected)).toEqual(['artifactRef', 'offset'])
    expect(projected.offset).toBe(3)
  })

  it('值里的密钥被脱敏', () => {
    const projected = redactToolInputForLog({ note: 'Bearer sk-abcdefgh12345678' }) as Record<string, string>
    expect(projected.note).not.toContain('abcdefgh12345678')
  })

  it('超长值截断，不把整段脚本写进日志', () => {
    const projected = redactToolInputForLog({ source: 'x'.repeat(5_000) }) as Record<string, string>
    expect(projected.source.length).toBeLessThan(260)
    expect(projected.source.endsWith('…')).toBe(true)
  })

  it('嵌套过深时停下，不会无限递归', () => {
    let deep: unknown = 'bottom'
    for (let index = 0; index < 12; index += 1) deep = { next: deep }
    expect(JSON.stringify(redactToolInputForLog(deep))).toContain('层级过深')
  })
})

