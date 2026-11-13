/** 设置页只读凭据摘要：掩码按密钥长度给圆点，不含任何明文字符。 */
export interface ProviderKeyInfo {
  configured: boolean
  maskedHint: string | null
  /** 存着密钥却解不开（换了设备、系统钥匙串被重置等），需要重新填写。 */
  unreadable: boolean
}
