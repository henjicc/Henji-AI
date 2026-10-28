const MAX_DEPTH = 8
const MAX_STRING_LENGTH = 1400
const LONG_STRING_HEAD = 320
const LONG_STRING_TAIL = 80

const knownSecrets = new Map<string, string>()
let secretValues: string[] = []

/** 以凭据槽为身份，只有保存或解密成功后登记；短草稿不能污染日志查询字段。 */
export function registerLogSecret(value: string, slot = value): void {
  if (knownSecrets.get(slot) === value) return
  if (value.length >= 12) knownSecrets.set(slot, value)
  else knownSecrets.delete(slot)
  secretValues = [...new Set(knownSecrets.values())].sort((a, b) => b.length - a.length)
}

export function unregisterLogSecret(slot: string): void {
  if (!knownSecrets.delete(slot)) return
  secretValues = [...new Set(knownSecrets.values())].sort((a, b) => b.length - a.length)
}

export function redactRegisteredSecretText(value: string): string {
  // 长值优先，避免一个凭据恰好是另一个凭据的前缀时留下后半段。
  for (const secret of secretValues) value = value.split(secret).join('***')
  return value
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().replace(/[- ]/g, '_')
  // 分页游标、数量与取帧标记不是认证材料，不能按 token 后缀吞掉诊断信息。
  if (/^(?:max_token|page_token|next_page_token|capture_token)$/.test(normalized)) return false
  return /^(?:access_key|secret_access_key|secret_key|authorization|proxy_authorization|cookie|set_cookie|private_key|bearer)$/.test(normalized)
    || /(?:^|_)(?:api_?keys?|token|secret|password|passwd|credentials?|secret_access_key|private_key)$/.test(normalized)
}

export function sanitizeCredentialText(value: string): string {
  return redactRegisteredSecretText(value)
    .replace(/\b((?:set-cookie|cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n"'}]+)/gi, '$1***')
    .replace(/\b((?:proxy-)?authorization["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;}]+)/gi, '$1***')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 ***')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|token)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}"']+)/gi, '$1***')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{30,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '***')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '***')
}

interface RedactionOptions {
  maxDepth?: number
  formatString?: (value: string) => string
}

function isStructuralField(key: string): boolean {
  return /^(?:timestamp|event|level|domain|source|id)$/i.test(key) || /(?:Id|_id|ID)$/.test(key)
}

/** 深度检查先于读子字段；共享对象只访问一次，避免菱形引用展开成指数大小。 */
function redactValue(value: unknown, text: (value: string) => string, options: RedactionOptions): unknown {
  const seen = new WeakSet<object>()
  const visit = (item: unknown, depth: number, key = ''): unknown => {
    if (depth >= (options.maxDepth ?? MAX_DEPTH)) return '[depth-limited]'
    if (typeof item === 'string') return isStructuralField(key) ? redactRegisteredSecretText(item) : (options.formatString ?? (text => text))(text(item))
    if (item === null || typeof item !== 'object') return typeof item === 'bigint' ? String(item) : item
    if (seen.has(item)) return '[circular]'
    seen.add(item)
    if (item instanceof Date) return item.toISOString()
    if (Array.isArray(item)) {
      // 只有明确的认证头元组有字段语义；普通二元数组仍是普通数据。
      if (item.length === 2 && typeof item[0] === 'string' && /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(item[0])) return [item[0], '***']
      return item.map(child => visit(child, depth + 1))
    }
    const fields = item instanceof Error ? { ...item, name: item.name, message: item.message, stack: item.stack, cause: item.cause } : item
    const errorIdentity = item instanceof Error || ((depth === 0 || key === 'error' || key === 'cause') && 'name' in fields && 'message' in fields)
    return Object.fromEntries(Object.entries(fields).map(([field, child]) => [field,
      isSensitiveKey(field) ? '***' : errorIdentity && (field === 'name' || field === 'code') && typeof child === 'string' ? redactRegisteredSecretText(child) : visit(child, depth + 1, field),
    ]))
  }
  return visit(value, 0)
}

export function redactLogCredentials(value: unknown, options: RedactionOptions = {}): unknown {
  return redactValue(value, sanitizeCredentialText, options)
}

/** 供应商正常结果与流事件只替换已知凭据，不按业务字段名猜测敏感内容。 */
export function redactRegisteredSecrets<T>(value: T): T {
  const seen = new WeakMap<object, unknown>()
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return redactRegisteredSecretText(item)
    if (item === null || typeof item !== 'object') return item
    if (seen.has(item)) return seen.get(item)
    if (Array.isArray(item)) {
      const result: unknown[] = []
      seen.set(item, result)
      for (const child of item) result.push(visit(child))
      return result
    }
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return item
    const result: Record<string, unknown> = {}
    seen.set(item, result)
    for (const [field, child] of Object.entries(item)) result[field] = visit(child)
    return result
  }
  return visit(value) as T
}

/** 只暂存可能是密钥开头的尾段，避免凭据跨流事件被拼回明文。 */
export function createRegisteredSecretStreamRedactor(): { write(value: string): string; flush(): string } {
  let pending = ''
  let pendingSecrets: string[] = []
  return {
    write(value) {
      const candidates = [...new Set([...secretValues, ...pendingSecrets])].sort((a, b) => b.length - a.length)
      let text = pending + value
      for (const secret of candidates) text = text.split(secret).join('***')
      let held = 0
      for (const secret of candidates) {
        for (let length = Math.min(secret.length - 1, text.length); length > held; length--) {
          if (text.endsWith(secret.slice(0, length))) { held = length; break }
        }
      }
      pending = held ? text.slice(-held) : ''
      // 登记表可以随用户替换而释放旧值；仅未决片段保留完成匹配所需的候选。
      pendingSecrets = held ? candidates : []
      return held ? text.slice(0, -held) : text
    },
    flush() { const text = pending; pending = ''; pendingSecrets = []; return text },
  }
}

function summarizeString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value
  }

  return `${value.slice(0, LONG_STRING_HEAD)}...(len=${value.length})...${value.slice(-LONG_STRING_TAIL)}`
}

export function sanitizeLogPayload(value: unknown): unknown {
  return redactLogCredentials(value, { formatString: summarizeString })
}
