import { describe, expect, it, vi } from 'vitest'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { chooseResultToPresent, presentConfirmedResult } from './result-presentation'
import type { AgentToolGateway } from '../tools/gateway'
import { contextSnapshot } from '../context/context-test-fixtures'
import { bindTaskExecutionPolicy } from '../context/task-execution-policy'

function observed(id: string, effect: 'update' | 'observe' | 'navigate' = 'update'): AgentToolObservation {
  return {
    source: { toolName: 'domain_operation', toolVersion: 1, toolCallId: id },
    trust: 'untrusted_observation', dataClasses: ['C1'], summary: '正式回执', output: {},
    effects: [{ effect, entityTypes: ['canvas.project'], propertyIds: [], targetRefs: [{ kind: 'canvas.project', id }],
      count: 1, verified: true, evidence: [] }],
  }
}

describe('confirmed result presentation', () => {
  it('多个业务结果只选择最后一个，后续读取不改变结果选择，已显式导航不重复展示', () => {
    expect(chooseResultToPresent([observed('A'), observed('B'), observed('C', 'observe')]))
      .toEqual({ ref: { kind: 'canvas.project', id: 'B' }, propertyIds: [] })
    expect(chooseResultToPresent([observed('A'), observed('chosen', 'navigate')])).toBeNull()
  })

  it('导航失败向收尾层报告，已尝试状态防止反复切页', async () => {
    const policy = bindTaskExecutionPolicy({
      intent: 'modify', forbiddenEffects: [], navigationRequested: false, clarification: '',
      sources: [{ messageId: 'user', quote: '修改工程' }],
    }, [{ messageId: 'user', content: '修改工程' }])
    const host = { ...contextSnapshot(), navigation: { userRevision: 0, source: 'system' as const } }
    policy.navigationBaseline = { rendererSessionId: host.rendererSessionId, userRevision: 0 }
    const execute = vi.fn().mockRejectedValue(new Error('目标窗口暂不可用'))
    const markAttempted = vi.fn(() => { policy.resultPresented = true })
    const input = { runId: 'run', threadId: 'thread', approvalMode: 'ask' as const, signal: new AbortController().signal,
      observations: [observed('A')], policy, gateway: { execute } as unknown as AgentToolGateway,
      getHost: () => host, markAttempted }
    await expect(presentConfirmedResult(input)).rejects.toThrow('目标窗口暂不可用')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'focus_application_entity', input: {
      ref: { kind: 'canvas.project', id: 'A' }, propertyIds: [], presentation: 'surface',
    } }))
    await presentConfirmedResult(input)
    expect(markAttempted).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
