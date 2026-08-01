import { describe, expect, it } from 'vitest'

import { toAgentRunStatus } from './applicationControlMapping'

describe('applicationControlMapping', () => {
  it('把调用方中立状态映射到现有助手运行状态', () => {
    expect(toAgentRunStatus('planned')).toBe('initializing')
    expect(toAgentRunStatus('waiting_approval')).toBe('waiting_approval')
    expect(toAgentRunStatus('waiting_external')).toBe('waiting_external')
    expect(toAgentRunStatus('completed')).toBe('completed')
  })
})

