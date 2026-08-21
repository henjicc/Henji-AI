function isRecord(value: DynamicValue): value is DynamicValueMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeServerTaskId(raw: DynamicValue): string | undefined {
  if (typeof raw !== 'string') return undefined
  const normalized = raw.trim().replace(/^["']|["']$/g, '')
  if (!normalized) return undefined
  const lower = normalized.toLowerCase()
  if (lower === 'dynamicvalue' || lower === 'null' || lower === 'undefined' || lower === 'none' || lower === 'n/a') {
    return undefined
  }
  return normalized
}

/**
 * 从供应商原始元数据中恢复可轮询任务 ID。
 * task_id/taskId/id 都比仅用于链路追踪的 request_id 优先。
 */
export function extractServerTaskIdFromMetadata(metadata: DynamicValue): string | undefined {
  if (!isRecord(metadata)) return undefined
  const taskObj = metadata['task']
  const dataObj = metadata['data']
  const taskRecord = isRecord(taskObj) ? taskObj : undefined
  const dataRecord = isRecord(dataObj) ? dataObj : undefined
  const candidates: DynamicValue[] = [
    metadata['task_id'],
    metadata['taskId'],
    taskRecord?.['task_id'],
    taskRecord?.['taskId'],
    taskRecord?.['id'],
    dataRecord?.['task_id'],
    dataRecord?.['taskId'],
    dataRecord?.['id'],
    // Fal 等供应商会把可轮询 ID 命名为 request_id；只能作为最后兜底，
    // 避免覆盖 APIMart 等响应中同时存在的真正任务 ID。
    metadata['request_id'],
    metadata['requestId'],
    taskRecord?.['request_id'],
    taskRecord?.['requestId'],
    dataRecord?.['request_id'],
    dataRecord?.['requestId'],
  ]
  for (const candidate of candidates) {
    const id = normalizeServerTaskId(candidate)
    if (id) return id
  }
  return undefined
}

export function extractServerTaskIdFromErrorMessage(message: string): string | undefined {
  for (const keyPattern of ['task_id|taskId', 'request_id|requestId']) {
    const keyValueMatches = message.matchAll(new RegExp(`\\b(?:${keyPattern})\\s*=\\s*([^\\s),;]+)`, 'gi'))
    for (const match of keyValueMatches) {
      const id = normalizeServerTaskId(match[1])
      if (id) return id
    }

    const jsonMatches = message.matchAll(new RegExp(`"(?:${keyPattern})"\\s*:\\s*"([^"]+)"`, 'gi'))
    for (const match of jsonMatches) {
      const id = normalizeServerTaskId(match[1])
      if (id) return id
    }
  }

  return undefined
}
