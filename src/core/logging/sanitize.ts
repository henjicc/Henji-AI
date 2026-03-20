const MAX_DEPTH = 8
const MAX_STRING_LENGTH = 1400
const LONG_STRING_HEAD = 320
const LONG_STRING_TAIL = 80

const SENSITIVE_KEY_PARTS = ['apikey', 'api_key', 'authorization', 'token', 'secret', 'password']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function maskText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 8) {
    return '***'
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

function sanitizeString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value
  }

  return `${value.slice(0, LONG_STRING_HEAD)}...(len=${value.length})...${value.slice(-LONG_STRING_TAIL)}`
}

function sanitizeSensitiveValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('Bearer ')) {
      return `Bearer ${maskText(value.slice(7))}`
    }
    return maskText(value)
  }
  return '***'
}

function sanitizeUnknown(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) {
    return '[depth-limited]'
  }

  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'string') {
    return sanitizeString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item, depth + 1))
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: sanitizeString(value.stack || ''),
    }
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {}

    Object.entries(value).forEach(([key, nested]) => {
      const lowerKey = key.toLowerCase()
      const isSensitive = SENSITIVE_KEY_PARTS.some((part) => lowerKey.includes(part))

      result[key] = isSensitive
        ? sanitizeSensitiveValue(nested)
        : sanitizeUnknown(nested, depth + 1)
    })

    return result
  }

  return String(value)
}

export function sanitizeLogPayload(value: unknown): unknown {
  return sanitizeUnknown(value, 0)
}
