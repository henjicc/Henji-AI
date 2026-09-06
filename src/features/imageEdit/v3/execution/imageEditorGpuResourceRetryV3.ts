/** 只对已有明确暂态 I/O 信息自动重试；未知错误、损坏格式及权限失败等待下一次显式请求。 */
export function isTransientImageEditorGpuResourceFailureV3(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  const message = error instanceof Error ? error.message : String(error)
  if (/AbortError|EACCES|EPERM|permission|denied|unsupported|invalid|corrupt|权限|格式|损坏/i.test(`${code} ${message}`)) return false
  return /EAGAIN|EBUSY|ETIMEDOUT|ECONNRESET|temporar|timed?\s*out|busy|concurrency limit|暂时|超时|繁忙/i.test(`${code} ${message}`)
}

export const IMAGE_EDITOR_GPU_RESOURCE_RETRY_DELAY_MS_V3 = 250
