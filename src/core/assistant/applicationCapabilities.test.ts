import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  ApplicationCapabilityRegistry,
  applicationCapabilityDescriptorSchema,
  type ApplicationCapabilityDefinition,
} from './applicationCapabilities'
import {
  BUILTIN_APPLICATION_CAPABILITY_REGISTRY,
} from './builtinApplicationCapabilityRegistry'

function capability(
  id: string,
  version = 1
): ApplicationCapabilityDefinition<Record<string, never>, { ok: boolean }> {
  return {
    id,
    version,
    title: id,
    description: `执行 ${id}`,
    domain: 'test',
    aliases: [],
    side: 'backend',
    readOnly: true,
    risk: 'R0',
    dataClasses: ['C0'],
    permission: 'test:read',
    idempotent: true,
    destructive: false,
    timeoutMs: 1_000,
    supportsPreview: false,
    supportsUndo: false,
    concurrencyKey: 'test',
    requiredScopes: [],
    availability: [],
    prerequisites: ['测试环境已就绪。'],
    acceptsRefs: [],
    producesRefs: [],
    successEvidence: ['返回 ok=true。'],
    failureRecovery: ['失败后停止。'],
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    aiInputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }
}

describe('ApplicationCapabilityRegistry', () => {
  it('拒绝重复 ID 和版本冲突', () => {
    const registry = new ApplicationCapabilityRegistry()
    registry.register(capability('read_test'))
    expect(() => registry.register(capability('read_test'))).toThrow('重复 ID')
    expect(() => registry.register(capability('read_test', 2))).toThrow('版本冲突')
  })

  it('缺少权限和成功证据时注册失败', () => {
    const missingPermission = { ...capability('missing_permission'), permission: '' }
    const missingEvidence = { ...capability('missing_evidence'), successEvidence: [] }
    expect(() => new ApplicationCapabilityRegistry().register(missingPermission)).toThrow()
    expect(() => new ApplicationCapabilityRegistry().register(missingEvidence)).toThrow()
  })

  it('拒绝开放额外字段、任意 Store Patch 和脚本执行输入', () => {
    const registry = new ApplicationCapabilityRegistry()
    expect(() => registry.register({
      ...capability('open_input'),
      aiInputSchema: { type: 'object', properties: {} },
    })).toThrow('拒绝未声明字段')
    for (const field of ['patch', 'storePatch', 'executeScript', 'script', 'code']) {
      expect(() => registry.register({
        ...capability(`unsafe_${field.toLowerCase()}`),
        aiInputSchema: {
          type: 'object', properties: { [field]: { type: 'string' } }, additionalProperties: false,
        },
      })).toThrow('禁止任意 Patch 或脚本输入')
    }
  })

  it('内建能力都有合法描述且 ID 唯一', () => {
    const descriptors = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.descriptors()
    expect(descriptors.length).toBeGreaterThanOrEqual(10)
    expect(new Set(descriptors.map((item) => item.id)).size).toBe(descriptors.length)
    for (const descriptor of descriptors) {
      expect(applicationCapabilityDescriptorSchema.safeParse(descriptor).success).toBe(true)
      expect(descriptor.successEvidence.length).toBeGreaterThan(0)
      expect(descriptor.permission).not.toBe('')
      expect(descriptor.failureRecovery.length).toBeGreaterThan(0)
    }
  })

  it('注册数量不设上限', () => {
    const registry = new ApplicationCapabilityRegistry()
    for (let index = 0; index < 100; index += 1) {
      registry.register(capability(`read_test_${index}`))
    }
    expect(registry.list()).toHaveLength(100)
  })
})
