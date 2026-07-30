import { describe, expect, it } from 'vitest'

import { decideAgentRecovery, type AgentFailurePosition } from './recovery-policy'

describe('Agent recovery matrix', () => {
  it.each<[AgentFailurePosition, string, boolean]>([
    ['before_model', 'retry_model', true],
    ['model_inflight', 'retry_model', true],
    ['before_tools', 'require_verification', true],
    ['read_tool_inflight', 'retry_read', true],
    ['write_tool_inflight', 'require_verification', false],
    ['after_tools', 'continue_next_turn', true],
  ])('%s -> %s', (position, action, automatic) => {
    expect(decideAgentRecovery(position)).toEqual({
      action, automatic, replayUnknownWrite: false,
    })
  })
})
