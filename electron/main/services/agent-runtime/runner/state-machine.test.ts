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

  it('等待用户回答可暂停并恢复到原等待状态', () => {
    const machine = new AgentStateMachine()
    machine.transition('running')
    machine.transition('waiting_user')
    machine.transition('paused')
    machine.transition('waiting_user')
    machine.transition('running')
    expect(machine.status).toBe('running')
  })

  it('外部等待释放 Runner 且只能进入故障或取消终局', () => {
    const machine = new AgentStateMachine()
    machine.transition('running')
    machine.transition('waiting_external')
    expect(isTerminalAgentState(machine.status)).toBe(true)
    expect(canTransitionAgentState('waiting_external', 'running')).toBe(false)
  })
})
