import { describe, expect, it } from 'vitest'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentContextBuildInput } from './types'
import { skillBuildInput } from './context-test-fixtures'
import { AgentArtifactStore, resolveOffloadByteThreshold, resolveOffloadRecordThreshold, shouldOffloadObservation } from './offload'
import { buildAgentContextLayers } from './prompt-layers'
import { sanitizeObservationValue } from './sanitize'

/*
 * 「同一个判断在两处各写一份」和「悄悄截断」是本次排查里出现频率最高的两类缺陷。
 * 这个文件把两者各钉一条：门槛只能有一把尺子，截断必须留痕。
 */

function observation(output: unknown): AgentToolObservation {
  return {
    source: { toolName: 'list_things', toolVersion: 1, toolCallId: 'call-1' },
    trust: 'untrusted_observation',
    dataClasses: ['C2'],
    summary: '列出条目',
    output,
  } as unknown as AgentToolObservation
}

function buildInput(contextWindowBudget: number, observations: AgentToolObservation[]): AgentContextBuildInput {
  return { ...skillBuildInput(undefined), contextWindowBudget, observations }
}

describe('卸载门槛只能有一把尺子', () => {
  it('条数门槛跟着字节门槛一起放大', () => {
    // 字节门槛改成跟上下文窗口走之后，条数门槛被落在原地——这正是「修完还剩一半」。
    const smallWindow = resolveOffloadByteThreshold(8_000)
    const largeWindow = resolveOffloadByteThreshold(1_000_000)
    expect(largeWindow).toBeGreaterThan(smallWindow)
    expect(resolveOffloadRecordThreshold(largeWindow))
      .toBeGreaterThan(resolveOffloadRecordThreshold(smallWindow))

    // 401 条、总共十几 KB 的清单，在大窗口下不应该被推去分页。
    const manySmallRecords = Array.from({ length: 401 }, (_, index) => ({ id: index }))
    expect(shouldOffloadObservation(manySmallRecords, smallWindow)).toBe(true)
    expect(shouldOffloadObservation(manySmallRecords, largeWindow)).toBe(false)
  })

  it('观察层与 tool 消息用同一个门槛，不会一边内联一边卸载', () => {
    // 40KB 结果：8KB 固定门槛下必然卸载；100 万窗口的实际门槛是 300KB，应当内联。
    const payload = { rows: Array.from({ length: 200 }, (_, index) => ({ id: index, text: 'x'.repeat(180) })) }
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeGreaterThan(8 * 1024)
    expect(shouldOffloadObservation(payload, resolveOffloadByteThreshold(1_000_000))).toBe(false)

    const { offloaded } = buildAgentContextLayers(
      buildInput(1_000_000, [observation(payload)]),
      [],
      new AgentArtifactStore()
    )
    expect(offloaded).toHaveLength(0)
  })

  it('窗口很小的时候照样卸载', () => {
    const payload = { rows: Array.from({ length: 200 }, (_, index) => ({ id: index, text: 'x'.repeat(180) })) }
    const { offloaded } = buildAgentContextLayers(
      buildInput(8_000, [observation(payload)]),
      [],
      new AgentArtifactStore()
    )
    expect(offloaded).toHaveLength(1)
  })
})

describe('截断必须留痕', () => {
  it('数组被砍掉的部分会明确告知，而不是凭空消失', () => {
    const sanitized = sanitizeObservationValue(Array.from({ length: 640 }, (_, index) => index))
    expect(Array.isArray(sanitized)).toBe(true)
    const items = sanitized as unknown[]
    // 500 项 + 1 条截断说明
    expect(items).toHaveLength(501)
    expect(String(items[500])).toContain('640')
    expect(String(items[500])).toContain('已截断')
  })

  it('没超限时不会平白多出一条说明', () => {
    const sanitized = sanitizeObservationValue(Array.from({ length: 500 }, (_, index) => index))
    expect(sanitized).toHaveLength(500)
  })
})
