const FORBIDDEN_PLAINTEXT_CREDENTIAL_FIELDS = new Set([
  'apikey',
  'authorization',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'secretkey',
  'clientsecret',
  'privatekey',
  'password',
])

function normalizeFieldName(value: string): string {
  return value.replace(/[_-]/g, '').toLowerCase()
}

/**
 * Provider/model 配置允许宿主扩展嵌套对象，因此明文凭据检查必须递归执行。
 * `credentialId`、`apiKeyManagementUrl` 等坐标/资料字段不会命中精确敏感字段名。
 */
export function rejectPlaintextCredentialFields(value: unknown, label: string): void {
  const visited = new WeakSet<object>()

  const visit = (candidate: unknown, path: string): void => {
    if (typeof candidate !== 'object' || candidate === null) return
    if (visited.has(candidate)) return
    visited.add(candidate)
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${path}[${index}]`))
      return
    }
    for (const [field, nested] of Object.entries(candidate)) {
      const fieldPath = `${path}.${field}`
      if (FORBIDDEN_PLAINTEXT_CREDENTIAL_FIELDS.has(normalizeFieldName(field))) {
        throw new Error(`[llm_plaintext_credential_forbidden] "${fieldPath}" must use the credential mutation field instead`)
      }
      visit(nested, fieldPath)
    }
  }

  visit(value, label)
}
