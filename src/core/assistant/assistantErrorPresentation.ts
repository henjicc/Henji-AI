/** 仅用于助手界面。原始错误仍留在运行日志，不改写工具结果或生成任务事实。 */
export function assistantErrorMessage(error: string): string {
  if (/insufficient[ _-]*(balance|quota|credit)|余额不足|余额已用尽|\b402\b/i.test(error))
    return '助手模型服务余额不足，回复已暂停。请检查该服务的余额或更换助手模型。已经提交的生成任务不会因此自动取消。'
  if (/\b401\b|invalid[ _-]*(api[ _-]*)?key|authentication|unauthorized/i.test(error))
    return '助手模型服务认证失败。请在设置中检查该服务的 API 密钥。'
  if (/\b403\b|permission denied|forbidden/i.test(error))
    return '助手模型服务拒绝了访问，请检查账号是否有权使用当前模型。'
  if (/\b429\b|rate[ _-]*limit|too many requests/i.test(error))
    return '助手模型服务请求过于频繁，请稍后继续。已经提交的任务仍可继续执行。'
  if (/context[ _-]*(length|window)|maximum context|too many tokens/i.test(error))
    return '这段对话超过了助手模型的长度限制，请新建对话后继续。'
  if (/timeout|timed out|ETIMEDOUT/i.test(error))
    return '等待助手模型回复超时，请稍后继续。已经提交的生成任务不会因此自动取消。'
  if (/ECONNRESET|ENOTFOUND|ECONNREFUSED|fetch failed|network|socket hang up/i.test(error))
    return '连接助手模型服务失败，请检查网络或代理后继续。已经提交的生成任务不会因此自动取消。'
  if (/\b50[0234]\b|service unavailable|internal server error/i.test(error))
    return '助手模型服务暂时无法响应，请稍后继续。'
  // 应用自身已经提供了可操作的中文说明时保留，第三方原始响应进入日志。
  if (/[\u4e00-\u9fff]/.test(error) && !/[{}]|Error:|stack|requestId/i.test(error)) return error
  return '助手本次回复未能完成，请稍后继续或检查助手模型设置。详细原因已记录到日志。'
}
