/** 设置页只读凭据摘要；短密钥不展示后缀，避免摘要等于完整密钥。 */
export interface ProviderKeyInfo {
  configured: boolean
  maskedHint: string | null
}
