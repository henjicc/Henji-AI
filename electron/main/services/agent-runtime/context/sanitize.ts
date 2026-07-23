import { isSensitiveKey } from '../../logging'

const maxDepth = 10
const maxStringLength = 64 * 1024

function sanitizeString(value: string): string {
  const withoutPaths = value.replace(/[A-Za-z]:\\[^\s"']+/g, '[本地路径]')
  const withoutUrlSecrets = withoutPaths.replace(/https?:\/\/[^\s]+/g, (url) => {
    try {
      const parsed = new URL(url)
      return `${parsed.origin}${parsed.pathname}`
    } catch {
      return '[URL]'
    }
  })
  return withoutUrlSecrets.length <= maxStringLength
    ? withoutUrlSecrets
    : `${withoutUrlSecrets.slice(0, maxStringLength)}…`
}

export function sanitizeObservationValue(value: unknown, depth = 0): unknown {
  if (depth >= maxDepth) return '[depth-limited]'
  if (typeof value === 'string') return sanitizeString(value)
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeObservationValue(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue
    output[key] = sanitizeObservationValue(item, depth + 1)
  }
  return output
}
