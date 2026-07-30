import { describe, expect, it } from 'vitest'

import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentToolRisk } from '../../../../../src/core/assistant/toolContracts'
import { decideToolAuthorization, type AgentToolAuthorizationDecision } from './approval-policy'

const modes: AgentApprovalMode[] = ['ask', 'assistant_decides', 'full_access']

function decide(
  mode: AgentApprovalMode,
  risk: AgentToolRisk,
  readOnly: boolean,
  destructive = false
): AgentToolAuthorizationDecision {
  return decideToolAuthorization({ mode, risk, readOnly, destructive, dataClasses: ['C0'] })
}

describe('decideToolAuthorization', () => {
  it('完整覆盖三种模式、五级风险与读写/破坏形态', () => {
    const expected: Record<AgentApprovalMode, Record<AgentToolRisk, [
      AgentToolAuthorizationDecision,
      AgentToolAuthorizationDecision,
      AgentToolAuthorizationDecision,
    ]>> = {
      ask: {
        R0: ['auto_allowed', 'auto_allowed', 'denied'],
        R1: ['auto_allowed', 'approval_required', 'approval_required'],
        R2: ['approval_required', 'approval_required', 'approval_required'],
        R3: ['approval_required', 'approval_required', 'approval_required'],
        R4: ['denied', 'denied', 'denied'],
      },
      assistant_decides: {
        R0: ['auto_allowed', 'auto_allowed', 'denied'],
        R1: ['auto_allowed', 'approval_required', 'approval_required'],
        R2: ['auto_allowed', 'approval_required', 'approval_required'],
        R3: ['approval_required', 'approval_required', 'approval_required'],
        R4: ['denied', 'denied', 'denied'],
      },
      full_access: {
        R0: ['auto_allowed', 'auto_allowed', 'denied'],
        R1: ['auto_allowed', 'auto_allowed', 'auto_allowed'],
        R2: ['auto_allowed', 'auto_allowed', 'auto_allowed'],
        R3: ['approval_required', 'approval_required', 'approval_required'],
        R4: ['denied', 'denied', 'denied'],
      },
    }
    const risks: AgentToolRisk[] = ['R0', 'R1', 'R2', 'R3', 'R4']
    for (const mode of modes) {
      for (const risk of risks) {
        expect([
          decide(mode, risk, true, false),
          decide(mode, risk, false, false),
          decide(mode, risk, true, true),
        ]).toEqual(expected[mode][risk])
      }
    }
  })

  it.each([
    ['ask', 'R0', false, 'auto_allowed'],
    ['ask', 'R1', true, 'auto_allowed'],
    ['ask', 'R1', false, 'approval_required'],
    ['ask', 'R2', true, 'approval_required'],
    ['ask', 'R2', false, 'approval_required'],
    ['ask', 'R3', true, 'approval_required'],
    ['assistant_decides', 'R0', false, 'auto_allowed'],
    ['assistant_decides', 'R1', true, 'auto_allowed'],
    ['assistant_decides', 'R1', false, 'approval_required'],
    ['assistant_decides', 'R2', true, 'auto_allowed'],
    ['assistant_decides', 'R2', false, 'approval_required'],
    ['assistant_decides', 'R3', true, 'approval_required'],
    ['full_access', 'R0', false, 'auto_allowed'],
    ['full_access', 'R1', false, 'auto_allowed'],
    ['full_access', 'R2', false, 'auto_allowed'],
    ['full_access', 'R3', false, 'approval_required'],
  ] as const)('%s / %s / readOnly=%s => %s', (mode, risk, readOnly, expected) => {
    expect(decide(mode, risk, readOnly)).toBe(expected)
  })

  it('破坏性标记不能借只读声明绕过 ask 或 assistant_decides', () => {
    expect(decide('full_access', 'R0', false, true)).toBe('denied')
    expect(decide('ask', 'R1', true, true)).toBe('approval_required')
    expect(decide('assistant_decides', 'R2', true, true)).toBe('approval_required')
  })

  it('助手判断模式只自动执行用户明确指定的可逆 R1 修改', () => {
    expect(decideToolAuthorization({
      mode: 'assistant_decides',
      risk: 'R1',
      readOnly: false,
      destructive: false,
      dataClasses: ['C1'],
      explicitUserIntent: true,
    })).toBe('auto_allowed')
    expect(decideToolAuthorization({
      mode: 'assistant_decides',
      risk: 'R1',
      readOnly: false,
      destructive: false,
      dataClasses: ['C1'],
      explicitUserIntent: false,
    })).toBe('approval_required')
  })

  it.each(modes)('C2 始终逐次审批，C3 与 R4 始终拒绝（%s）', (mode) => {
    expect(decideToolAuthorization({
      mode,
      risk: 'R1',
      readOnly: true,
      destructive: false,
      dataClasses: ['C2'],
    })).toBe('approval_required')
    expect(decideToolAuthorization({
      mode,
      risk: 'R0',
      readOnly: true,
      destructive: false,
      dataClasses: ['C3'],
    })).toBe('denied')
    expect(decide(mode, 'R4', true)).toBe('denied')
  })
})
