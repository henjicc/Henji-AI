import { describe, expect, it } from 'vitest'

import {
  AgentStateMachine,
  InvalidAgentStateTransitionError,
  canTransitionAgentState,
  isTerminalAgentState,
} from './state-machine'

describe('AgentStateMachine', () => {
  it('接受运行、工具等待、审批等待和完成路径', () => {
    const machine = new AgentStateMachine()
    machine.transition('running')
    machine.transition('waiting_tool')
    machine.transition('waiting_approval')
    machine.transition('waiting_tool')
    machine.transition('running')
    machine.transition('completed')
    expect(machine.status).toBe('completed')
    expect(isTerminalAgentState(machine.status)).toBe(true)
  })

  it('拒绝终态恢复和非法跳转', () => {
    const machine = new AgentStateMachine()
    expect(canTransitionAgentState('initializing', 'completed')).toBe(false)
    expect(() => machine.transition('completed')).toThrow(InvalidAgentStateTransitionError)
    machine.transition('cancelled')
    expect(() => machine.transition('running')).toThrow(InvalidAgentStateTransitionError)
  })
})
