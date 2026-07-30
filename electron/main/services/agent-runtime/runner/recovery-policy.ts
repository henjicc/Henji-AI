export type AgentFailurePosition =
  | 'before_model'
  | 'model_inflight'
  | 'before_tools'
  | 'read_tool_inflight'
  | 'write_tool_inflight'
  | 'after_tools'

export interface AgentRecoveryDecision {
  action: 'retry_model' | 'retry_read' | 'continue_next_turn' | 'require_verification'
  automatic: boolean
  replayUnknownWrite: false
}

export function decideAgentRecovery(position: AgentFailurePosition): AgentRecoveryDecision {
  if (position === 'before_model' || position === 'model_inflight') {
    return { action: 'retry_model', automatic: true, replayUnknownWrite: false }
  }
  if (position === 'read_tool_inflight') {
    return { action: 'retry_read', automatic: true, replayUnknownWrite: false }
  }
  if (position === 'after_tools') {
    return { action: 'continue_next_turn', automatic: true, replayUnknownWrite: false }
  }
  return {
    action: 'require_verification',
    automatic: position === 'before_tools',
    replayUnknownWrite: false,
  }
}
