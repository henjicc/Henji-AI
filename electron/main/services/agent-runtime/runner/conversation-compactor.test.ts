import { describe, expect, it } from 'vitest'

import type { ModelStepMessage } from '@henjicc/ai-sdk'
import { AgentConversationCompactor } from './conversation-compactor'
import type { AgentRuntimeModel } from './models'

function message(index: number): ModelStepMessage {
  return { role: 'assistant', content: `第 ${index} 条消息：${'内容'.repeat(400)}` }
}

function createCompactor(conversation: ModelStepMessage[]): AgentConversationCompactor {
  return new AgentConversationCompactor({
    runId: 'run-1',
    threadId: 'thread-1',
    // 窗口刻意开小，好让确定性压缩真的把历史压短，而不是原样返回。
    model: { limits: { contextWindow: 3_000 } } as unknown as AgentRuntimeModel,
    conversation,
    sourceSequences: conversation.map((_, index) => index + 1),
    runModelStep: async () => { throw new Error('测试不发起模型请求') },
    signal: new AbortController().signal,
    recordUsage: () => {},
    setCurrentModelRequestId: () => {},
    throwIfCancelled: () => {},
  })
}

/*
 * 溢出恢复曾经是整次运行一次性的开关：第二次溢出直接不给恢复。
 * 轮次预算放大到 70 轮之后，长任务溢出两回是常态，等于给长任务埋雷——而且报出来的错误
 * 还说"压缩后仍超过限制"，压根没压缩过。
 */
describe('上下文溢出恢复的闸门', () => {
  it('同一轮里历史没变化时不重复恢复，避免打转', () => {
    const conversation = [message(1), message(2), message(3)]
    const compactor = createCompactor(conversation)
    expect(compactor.beginOverflowRecovery()).toBe(true)
    expect(compactor.beginOverflowRecovery()).toBe(false)
  })

  it('压缩确实缩短了历史、后续又长回来之后，允许再次恢复', () => {
    const conversation = Array.from({ length: 12 }, (_, index) => message(index))
    const compactor = createCompactor(conversation)
    expect(compactor.beginOverflowRecovery()).toBe(true)

    // 第一次恢复：确定性压缩把历史压短
    expect(compactor.compactDeterministically()).toBe(true)
    const compactedLength = conversation.length
    expect(compactedLength).toBeLessThan(12)

    // 紧接着又溢出、历史没变 → 仍然拒绝
    expect(compactor.beginOverflowRecovery()).toBe(false)

    // 后续轮次继续追加消息 → 这是一次全新的溢出，必须还能恢复
    conversation.push(message(100), message(101))
    expect(compactor.beginOverflowRecovery()).toBe(true)
  })
})
