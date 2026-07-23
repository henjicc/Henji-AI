import { describe, expect, it } from 'vitest'

import { DEFAULT_LLM_CAPABILITIES } from './defaults'
import type { CapabilitySmokeCheckId, ModelCapabilitySmokeResult } from './capabilitySmoke'
import { applyCapabilitySmokeToCapabilities } from './capabilitySmokeCapabilities'

function createResult(passedIds: CapabilitySmokeCheckId[]): ModelCapabilitySmokeResult {
  return {
    providerId: 'provider',
    modelId: 'model',
    adapterVersion: 'test',
    verifiedAt: '2026-07-23T00:00:00.000Z',
    checks: passedIds.map(id => ({
      id,
      status: 'passed',
      latencyMs: 1,
    })),
    totalLatencyMs: 1,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    cost: { status: 'unknown' },
  }
}

describe('applyCapabilitySmokeToCapabilities', () => {
  it('把实测通过的 Agent 必需能力同步到静态能力', () => {
    const capabilities = applyCapabilitySmokeToCapabilities(
      DEFAULT_LLM_CAPABILITIES,
      createResult(['text', 'streaming', 'toolCall', 'structuredOutput', 'usage']),
      'json'
    )

    expect(capabilities).toMatchObject({
      text: true,
      streaming: true,
      toolCall: true,
      jsonOutput: true,
      structuredOutputMode: 'json',
      usage: true,
    })
  })

  it('失败项不会降低用户已声明的能力', () => {
    const capabilities = applyCapabilitySmokeToCapabilities({
      ...DEFAULT_LLM_CAPABILITIES,
      toolCall: true,
      jsonOutput: true,
      structuredOutputMode: 'schema',
    }, createResult(['text']), 'schema')

    expect(capabilities.toolCall).toBe(true)
    expect(capabilities.structuredOutputMode).toBe('schema')
  })
})
