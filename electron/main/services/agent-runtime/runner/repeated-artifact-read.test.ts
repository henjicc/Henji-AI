import { describe, expect, it } from 'vitest'

import { AgentToolExecutionCoordinator } from './tool-execution-coordinator'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'

/*
 * 回归：一次运行 38 次 read_agent_artifact、6 个 ref 各读 4 次、25 个模型步仍未收敛。
 *
 * 预算里的 repeatedToolCalls 只比连续相同的签名，模型交替读几个 artifact 就绕过去了，
 * 全程没有任何东西拦它。这条判的是事实：同一 (ref, cursor) 的返回逐字节相同。
 */
function call(input: Record<string, unknown>, toolName = 'read_agent_artifact'): ModelStepToolCall {
  return { toolCallId: `call-${JSON.stringify(input)}`, toolName, input, dynamic: false }
}

function createCoordinator(): AgentToolExecutionCoordinator {
  return Object.create(AgentToolExecutionCoordinator.prototype) as AgentToolExecutionCoordinator
}

function reject(
  coordinator: AgentToolExecutionCoordinator,
  toolCall: ModelStepToolCall
): { code: string; reason: string } | null {
  const guard = coordinator as unknown as {
    servedArtifactReads?: Set<string>
    rejectRepeatedArtifactRead: (call: ModelStepToolCall) => { code: string; reason: string } | null
  }
  guard.servedArtifactReads ??= new Set<string>()
  return guard.rejectRepeatedArtifactRead(toolCall)
}

describe('重复读取同一 artifact 分页', () => {
  it('首次读取放行，同一页再读被拦', () => {
    const coordinator = createCoordinator()
    const first = call({ artifactRef: 'artifact:a', cursor: 0 })
    expect(reject(coordinator, first)).toBeNull()
    const second = reject(coordinator, call({ artifactRef: 'artifact:a', cursor: 0 }))
    expect(second?.code).toBe('INVALID_INPUT')
    expect(second?.reason).toContain('nextCursor')
  })

  // 交替读多个 ref 正是绕过连续签名判定的那条路径，必须每个 ref 各自记账。
  it('交替读多个 artifact 时每个 ref 各自计数', () => {
    const coordinator = createCoordinator()
    for (const ref of ['artifact:a', 'artifact:b', 'artifact:c']) {
      expect(reject(coordinator, call({ artifactRef: ref, cursor: 0 })), ref).toBeNull()
    }
    for (const ref of ['artifact:a', 'artifact:b', 'artifact:c']) {
      expect(reject(coordinator, call({ artifactRef: ref, cursor: 0 }))?.code, ref).toBe('INVALID_INPUT')
    }
  })

  it('带不同游标继续往下读不被拦', () => {
    const coordinator = createCoordinator()
    expect(reject(coordinator, call({ artifactRef: 'artifact:a', cursor: 0 }))).toBeNull()
    expect(reject(coordinator, call({ artifactRef: 'artifact:a', cursor: 512 }))).toBeNull()
    expect(reject(coordinator, call({ artifactRef: 'artifact:a' }))).toBeNull()
  })

  it('其他工具与缺少 artifactRef 的调用一律不拦', () => {
    const coordinator = createCoordinator()
    expect(reject(coordinator, call({ artifactRef: 'artifact:a' }, 'run_henji_script'))).toBeNull()
    expect(reject(coordinator, call({ artifactRef: 'artifact:a' }, 'run_henji_script'))).toBeNull()
    expect(reject(coordinator, call({}))).toBeNull()
    expect(reject(coordinator, call({}))).toBeNull()
  })
})
