import { describe, expect, it } from 'vitest'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepMessage } from '@henjicc/ai-sdk'
import type { AgentContextBuildInput } from './types'
import { skillBuildInput } from './context-test-fixtures'
import { AgentArtifactStore } from './offload'
import { buildAgentContextLayers } from './prompt-layers'

/*
 * observations 层的唯一职责是"登记对话历史里取不到的观察"。
 *
 * 实测：每条观察在 runner 里都会同时写进 observations 和一条 tool 消息，于是未卸载的结果
 * 在上下文中存在两份——tool 消息里的完整数据，加本层一段 320 字符预览。后者对模型零增量，
 * 却占 ~3900 tokens/轮（1M 窗口下约整包的 10%）。但被卸载的结果不一样：tool 消息里只剩
 * largeResultOmitted，artifactRef 唯一存在于本层，删了模型就再也拿不回正文。
 */

function observation(toolCallId: string, output: unknown): AgentToolObservation {
  return {
    source: { toolName: 'list_things', toolVersion: 1, toolCallId },
    trust: 'untrusted_observation',
    dataClasses: ['C2'],
    summary: `${toolCallId} 结果`,
    output,
  } as unknown as AgentToolObservation
}

function toolMessage(toolCallId: string): ModelStepMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId,
      toolName: 'list_things',
      output: { type: 'json', value: { summary: '结果', data: { rows: [1, 2, 3] } } },
    }],
  } as unknown as ModelStepMessage
}

function buildInput(input: {
  observations: AgentToolObservation[]
  conversation: ModelStepMessage[]
  contextWindowBudget?: number
}): AgentContextBuildInput {
  return {
    ...skillBuildInput(undefined),
    contextWindowBudget: input.contextWindowBudget ?? 1_000_000,
    observations: input.observations,
    conversation: input.conversation,
  }
}

function observationLayer(input: AgentContextBuildInput): string {
  const { layers } = buildAgentContextLayers(input, [], new AgentArtifactStore())
  return layers.find((layer) => layer.id === 'observations')?.content ?? ''
}

describe('observations 索引只登记对话里取不到的观察', () => {
  it('对话里已内联的结果不再重复登记', () => {
    const content = observationLayer(buildInput({
      observations: [observation('call-1', { rows: [1, 2, 3] })],
      conversation: [toolMessage('call-1')],
    }))
    expect(content).toBe('')
  })

  it('对话里没有对应 tool 消息时保留登记', () => {
    // 守卫合成的观察走 modelOutputGuard，压根不会产生 tool 消息。
    const content = observationLayer(buildInput({
      observations: [observation('guard-1', { rejected: true })],
      conversation: [],
    }))
    expect(content).toContain('guard-1')
  })

  it('压缩把 tool 消息换成摘要之后自动恢复登记', () => {
    const compacted: ModelStepMessage[] = [
      { role: 'user', content: '[历史摘要] 之前调用过 list_things' },
    ]
    const content = observationLayer(buildInput({
      observations: [observation('call-1', { rows: [1, 2, 3] })],
      conversation: compacted,
    }))
    expect(content).toContain('call-1')
  })

  it('被卸载的结果即使对话里有 tool 消息也必须留下 artifactRef', () => {
    // 小窗口下门槛回到 8KB，这份 40KB 结果必然卸载；此时 tool 消息里只有 largeResultOmitted。
    const large = { rows: Array.from({ length: 200 }, (_, index) => ({ id: index, text: 'x'.repeat(180) })) }
    const content = observationLayer(buildInput({
      observations: [observation('call-big', large)],
      conversation: [toolMessage('call-big')],
      contextWindowBudget: 8_000,
    }))
    expect(content).toContain('artifactRef')
    expect(content).toContain('read_agent_artifact')
  })

  it('说明只出现一次，不随条数重复', () => {
    const content = observationLayer(buildInput({
      observations: ['a', 'b', 'c'].map((id) => observation(id, { value: id })),
      conversation: [],
    }))
    expect(content.split('不要因本索引重复调用相同查询').length - 1).toBe(1)
    for (const id of ['a', 'b', 'c']) expect(content).toContain(id)
  })

  it('全部已内联时整层被省略，不占预算', () => {
    const ids = ['c1', 'c2', 'c3']
    const { layers } = buildAgentContextLayers(
      buildInput({
        observations: ids.map((id) => observation(id, { value: id })),
        conversation: ids.map(toolMessage),
      }),
      [],
      new AgentArtifactStore()
    )
    expect(layers.some((layer) => layer.id === 'observations')).toBe(false)
  })
})
