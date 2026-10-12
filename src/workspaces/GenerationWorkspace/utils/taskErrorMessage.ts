import type { TFunction } from 'i18next'

/**
 * 历史记录唯一的错误展示入口。保留 SDK 已映射的用户说明，剥离运行时包装；
 * 未映射的供应商原文按错误类别本地化。原始 task.error 仍交给日志和助手诊断。
 */
export function taskErrorMessage(raw: string | undefined, provider: string | undefined, t: TFunction): string {
  const source = raw ?? ''
  const message = source.trim()
    .replace(/^(?:Continue polling|Generation) failed(?: for [^:]+)?:\s*/i, '')
    .replace(/^\[[a-z_]+\]\s*/i, '')
  // 与 SDK 的 KIE provider_internal_error 用户映射一致；也覆盖带运行时包装的供应商响应。
  if ((provider === 'kie' || /\bkie[- :]|KIE 服务/i.test(source))
    && /Internal Error|KIE 服务内部错误/i.test(message)) return t('history:failure.kieInternal')
  if (/\[provider_internal_error\]|internal (?:server )?error|service unavailable/i.test(source)) return t('history:failure.service')
  if (/api_key_missing|api key not configured|invalid api.?key|unauthorized/i.test(source)) return t('history:failure.credentials')
  if (/insufficient.*(?:balance|credit|quota)/i.test(source)) return t('history:failure.balance')
  if (/timeout|timed out/i.test(source)) return t('history:failure.timeout')
  if (/fetch failed|failed to fetch|network|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(source)) return t('history:failure.network')
  if (/content.*(?:policy|moderation)|nsfw/i.test(source)) return t('history:failure.content')
  // 宿主和 SDK 已提供可理解的说明时直接使用；报文、堆栈和内部字段不能透出到列表。
  if (/[\u4e00-\u9fff]/.test(message) && !/[{}]|\[[a-z_]+\]|Error:|requestId|taskId|\bat \w+.*\(/i.test(message)) return message
  return t('history:failure.unknown')
}
