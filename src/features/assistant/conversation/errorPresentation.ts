import type { SerializedAgentError } from '@/core/assistant/events'

const recoveryLabels: Record<SerializedAgentError['recovery'], string> = {
  refresh_context: '刷新当前上下文后重新规划。',
  request_approval: '确认操作范围后重新发起审批。',
  wait: '等待目标就绪后再试。',
  user_action: '根据错误信息补充或修正必要内容。',
  none: '检查错误原因后选择其他安全做法。',
}

export function describeErrorRecovery(error: SerializedAgentError): string {
  return recoveryLabels[error.recovery]
}
