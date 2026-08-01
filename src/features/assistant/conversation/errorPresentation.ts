import type { SerializedAgentError } from '@/core/assistant/events'

const recoveryLabels: Record<SerializedAgentError['recovery'], string> = {
  refresh_context: '刷新当前上下文后重新规划。',
  request_approval: '确认操作范围后重新发起审批。',
  wait: '等待目标就绪后再试。',
  user_action: '根据错误信息补充或修正必要内容。',
  none: '检查错误原因后选择其他安全做法。',
}

export interface StructuredErrorPresentation {
  title: string
  nextAction: string
}

const TITLES_BY_CODE: Record<string, string> = {
  CAPABILITY_NOT_READY: '所需能力暂不可用',
  CAPABILITY_NOT_FOUND: '没有找到所需能力',
  PERMISSION_DENIED: '当前权限不允许继续',
  APPROVAL_REJECTED: '操作未获批准',
  APPROVAL_EXPIRED: '操作批准已过期',
  CONFLICT: '目标状态已经变化',
  REVISION_CONFLICT: '目标状态已经变化',
  PLAN_REVISION_CONFLICT: '执行计划已经过期',
  NAVIGATION_FAILED: '无法打开或定位目标',
  NOT_FOUND: '没有找到目标',
  VERIFICATION_FAILED: '结果验证未通过',
  VERIFICATION_REPAIR_FAILED: '结果仍未通过验证',
  NO_PROGRESS: '连续尝试没有取得新进展',
  REPEATED_TOOL_CALL: '重复操作已被停止',
  INVALID_INPUT: '输入信息不完整或无效',
  CANCELLED: '操作已取消',
}

export function describeStructuredError(error: SerializedAgentError): StructuredErrorPresentation {
  const normalizedCode = error.code.trim().toUpperCase()
  const title = TITLES_BY_CODE[normalizedCode]
    ?? (normalizedCode.includes('REVISION_CONFLICT') ? TITLES_BY_CODE.REVISION_CONFLICT : '执行未完成')
  return { title, nextAction: recoveryLabels[error.recovery] }
}

export function describeErrorRecovery(error: SerializedAgentError): string {
  return describeStructuredError(error).nextAction
}
