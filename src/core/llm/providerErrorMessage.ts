const PROVIDER_ERROR_MARKER = '[provider_error]'

/**
 * 大语言模型调用失败时给用户看的文字。运行时把供应商错误序列化成
 * `[provider_error]{code, category, status, providerId, modelId, requestId, message}`；
 * 正式界面只展示其中面向用户的 `message`（SDK 已按类别写成可理解的后果），
 * 请求 ID、状态码等内部字段只进日志（任务 5.3，信息准入）。不是供应商错误或解析不了时原样返回。
 *
 * 提示词优化已接入；画布文本处理节点（textProcessingExecutor）同一出口，交 5.4 接入。
 */
export function describeLlmProviderError(raw: string): string {
  const markerIndex = raw.indexOf(PROVIDER_ERROR_MARKER)
  if (markerIndex < 0) return raw
  try {
    const details: unknown = JSON.parse(raw.slice(markerIndex + PROVIDER_ERROR_MARKER.length))
    if (details && typeof details === 'object' && 'message' in details && typeof details.message === 'string' && details.message.trim()) {
      return details.message.trim()
    }
  } catch {
    // 不是完整的 JSON：退回原文
  }
  return raw
}
