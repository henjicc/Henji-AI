import { isSensitiveKey } from '../../logging'
import { redactAgentText } from '../tools/security'

const maxDepth = 10
const maxStringLength = 64 * 1024
const maxArrayLength = 500

function sanitizeString(value: string): string {
  const withoutPaths = redactAgentText(value).replace(/[A-Za-z]:\\[^\s"']+/g, '[本地路径]')
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
  if (Array.isArray(value)) {
    /*
     * 截断必须留痕。
     *
     * 旧实现直接 slice 到 500 条就交给模型，多出来的部分凭空消失且毫无标记——模型拿到一份
     * 看起来完整的列表，据此判断"没有更多了"，随后所有推理都建立在错的前提上。截断本身可以
     * 接受，"截断了却装作没截断"不行：宁可少一条真数据，也要多一条说明。
     */
    const items = value.slice(0, maxArrayLength).map((item) => sanitizeObservationValue(item, depth + 1))
    return value.length > maxArrayLength
      ? [...items, `[已截断：共 ${value.length} 项，此处只保留前 ${maxArrayLength} 项，请用分页或过滤参数获取其余部分]`]
      : items
  }
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue
    output[key] = sanitizeObservationValue(item, depth + 1)
  }
  return output
}
