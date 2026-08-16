import { describe, expect, it } from 'vitest'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import { toolMessage } from '../runner/runner-results'
import { buildAgentContextLayers } from './prompt-layers'
import { skillBuildInput } from './context-test-fixtures'
import { AgentArtifactStore, shouldOffloadObservation } from './offload'
import type { AgentContextBuildInput } from './types'

/*
 * 回归：同一份工具结果在 tool 消息里被内联、在观察层却被卸载成 artifact。
 *
 * 两处都调 shouldOffloadObservation，但量的东西不同——toolMessage 量 projectForHistory
 * 之后的体积，观察层量的是原始 output。于是模型在 tool 消息里已经拿到完整内容，观察层又
 * 递给它一个 artifactRef，它就老老实实去分页读回一份自己已经有的东西。实测一次运行
 * 18 次 read_agent_artifact、25 个模型步不收敛。
 *
 * prompt-layers 里那行注释本来就写着"必须和 runner-results.toolMessage 用同一把尺子"——
 * 上次修补的是 contextWindow，漏了投影这一半。
 */
const CONTEXT_WINDOW = 64_000

/** 原始体积远超阈值、投影后只剩一点点——正是能力发现结果的形状。 */
function bulkyOutput(): Record<string, unknown> {
  return {
    summary: '能力发现结果',
    bulk: Array.from({ length: 400 }, (_, index) => ({
      name: `capability_${index}`,
      inputSchema: { type: 'object', properties: { value: { type: 'string', description: '描'.repeat(40) } } },
    })),
    keep: 'ok',
  }
}

function project(output: unknown): unknown {
  const record = output as Record<string, unknown>
  return { summary: record.summary, keep: record.keep }
}

function observation(): AgentToolObservation {
  return {
    source: { toolName: 'discover_application_capabilities', toolVersion: 1, toolCallId: 'call-1' },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: '发现完成',
    output: bulkyOutput(),
  }
}

/**
 * 观察层里这条结果是否真的被卸载了。
 *
 * 不能对整层内容做 `includes('artifactRef')`——该层开头的固定说明文字里就带着这个词，
 * 那样无论有没有卸载都恒为真。判据只看这条记录本身有没有 artifactRef 字段。
 */
function offloadedInObservationLayer(
  resolveHistoryProjection?: (toolName: string) => ((output: unknown) => unknown) | undefined
): boolean {
  const input: AgentContextBuildInput = {
    ...skillBuildInput(undefined),
    contextWindowBudget: CONTEXT_WINDOW,
    observations: [observation()],
    conversation: [],
    resolveHistoryProjection,
  }
  const { layers } = buildAgentContextLayers(input, [], new AgentArtifactStore())
  const content = layers.find((layer) => layer.id === 'observations')?.content ?? ''
  return content
    .split('\n')
    .filter((line) => line.includes('"toolCallId"'))
    .some((line) => line.includes('"artifactRef"'))
}

describe('卸载判定的同一把尺子', () => {
  const call: ModelStepToolCall = {
    toolCallId: 'call-1', toolName: 'discover_application_capabilities', input: {}, dynamic: false,
  }

  it('tool 消息内联时观察层不得卸载成 artifact', () => {
    const message = toolMessage(call, observation(), CONTEXT_WINDOW, () => project)
    expect(
      JSON.stringify(message).includes('largeResultOmitted'),
      'tool 消息应当内联：投影后体积很小',
    ).toBe(false)

    expect(
      offloadedInObservationLayer(() => project),
      '观察层不该卸载：tool 消息已内联同一份内容，再给 artifactRef 会让模型去读它已经有的东西。',
    ).toBe(false)
  })

  it('没有投影函数时两处一致地卸载', () => {
    const message = toolMessage(call, observation(), CONTEXT_WINDOW)
    expect(JSON.stringify(message)).toContain('largeResultOmitted')
    expect(offloadedInObservationLayer()).toBe(true)
  })
})

/*
 * 回归：读 artifact 的结果又被卸载成新 artifact，无限套娃。
 *
 * 分页上限 32KB、卸载阈值最低 8KB，所以读回来的一页必然超阈值。模型读 A 拿到页 B，
 * B 被卸载成 C……而页的顶层字段是 schemaVersion/content/nextCursor 那一套，跟它想读的
 * 内容完全不同形状。实测 camera 场景因此 31 轮 0 个 Effect。
 */
describe('分页结果不再被卸载', () => {
  const page = {
    schemaVersion: 'agent-artifact/v1',
    artifactRef: 'artifact:a',
    source: 'discover_application_capabilities',
    dataClasses: ['C1'],
    contentEncoding: 'json-fragment',
    content: 'x'.repeat(30_000),
    returnedBytes: 30_000,
    totalBytes: 90_000,
    nextCursor: 'v1:30000:abcdef0123456789',
    hasMore: true,
    selectedFields: [],
    missingFields: [],
  }

  it('远超阈值的分页结果也不卸载', () => {
    expect(shouldOffloadObservation(page, 8 * 1024)).toBe(false)
  })

  it('形状相近但不是分页结果的照常卸载', () => {
    const notPage = { ...page, contentEncoding: 'text/plain' }
    expect(shouldOffloadObservation(notPage, 8 * 1024)).toBe(true)
  })
})

