/** 设置页只读凭据摘要：掩码按密钥长度给圆点，不含任何明文字符。 */
export interface ProviderKeyInfo {
  configured: boolean
  maskedHint: string | null
}
