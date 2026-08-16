import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineAgentTool } from './define-tool'
import { AgentToolRegistry } from './registry'

function internalWrite(resolveEffects = true) {
  return {
    name: 'resume_henji_script', version: 1, title: '内部续跑', description: '测试内部续跑。',
    category: 'application', side: 'backend' as const, modelVisible: false,
    risk: 'R1' as const, permission: 'application:script:execute', readOnly: false,
    destructive: false, openWorld: false, idempotent: false, timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false,
    supportsUndo: false, requiredContext: [], inputSchema: z.object({}).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    aiInputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ ok: true }), concurrencyKey: () => 'script',
    targetIds: () => ({}), dataClasses: () => ['C1' as const], summarize: () => '完成',
    ...(resolveEffects ? { resolveObservedEffects: () => [] } : {}),
  }
}

describe('运行时内部工具可见性', () => {
  it('内部续跑可由 Gateway 定位，但不会进入模型目录或 schema', () => {
    const registry = new AgentToolRegistry()
    registry.register(defineAgentTool(internalWrite()))

    expect(registry.get('resume_henji_script')).toBeDefined()
    expect(registry.list().some((item) => item.name === 'resume_henji_script')).toBe(false)
    expect(registry.registrations(['resume_henji_script'], null)).toEqual([])
  })

  it('内部写工具缺少 Effect resolver 时注册定义立即失败', () => {
    expect(() => defineAgentTool(internalWrite(false)))
      .toThrow('内部写工具必须声明强类型 Effect resolver')
  })
})
