import { isRecord } from './typeGuards'

function normalizeServerTaskId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const normalized = raw.trim().replace(/^["']|["']$/g, '')
  if (!normalized) return undefined
  const lower = normalized.toLowerCase()
  if (lower === 'unknown' || lower === 'null' || lower === 'undefined' || lower === 'none' || lower === 'n/a') {
    return undefined
  }
  return normalized
}

export function extractServerTaskIdFromMetadata(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined
  const candidates: unknown[] = [metadata['task_id'], metadata['taskId'], metadata['request_id'], metadata['requestId']]
  const taskObj = metadata['task']
  const dataObj = metadata['data']
  if (isRecord(taskObj)) {
    candidates.push(taskObj['task_id'], taskObj['taskId'], taskObj['request_id'], taskObj['requestId'])
  }
  if (isRecord(dataObj)) {
    candidates.push(dataObj['task_id'], dataObj['taskId'], dataObj['request_id'], dataObj['requestId'])
  }
  for (const candidate of candidates) {
    const id = normalizeServerTaskId(candidate)
    if (id) return id
  }
  return undefined
}

export function extractServerTaskIdFromErrorMessage(message: string): string | undefined {
  const keyValueMatches = message.matchAll(/\b(?:task_id|taskId|request_id|requestId)\s*=\s*([^\s),;]+)/gi)
  for (const match of keyValueMatches) {
    const id = normalizeServerTaskId(match[1])
    if (id) return id
  }

  const jsonMatches = message.matchAll(/"(?:task_id|taskId|request_id|requestId)"\s*:\s*"([^"]+)"/gi)
  for (const match of jsonMatches) {
    const id = normalizeServerTaskId(match[1])
    if (id) return id
  }

  return undefined
}
