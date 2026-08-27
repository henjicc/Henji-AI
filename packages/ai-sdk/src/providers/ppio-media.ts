export type PpioMediaRewriteMode = 'data-uri' | 'raw-base64' | 'public-url'

export function resolvePpioMediaRewriteMode(
  route: string,
  fieldName: string | undefined,
  isVideo: boolean
): PpioMediaRewriteMode {
  const normalized = fieldName?.trim().toLowerCase() ?? ''

  if (normalized.endsWith('_base64') || normalized.endsWith('_base64s')) {
    return 'raw-base64'
  }
  if (normalized.endsWith('_url') || normalized.endsWith('_urls') || isVideo) {
    return 'public-url'
  }
  if (normalized === 'reference_voice') {
    return 'public-url'
  }

  if (route === '/v1/chat/completions' && normalized === 'url') return 'public-url'
  if (route === '/async/kling-v3.0-4k-i2v' && (normalized === 'image' || normalized === 'end_image')) {
    return 'public-url'
  }
  if (route === '/async/kling-v3.0-motion-control' && normalized === 'image') return 'public-url'

  return 'data-uri'
}
