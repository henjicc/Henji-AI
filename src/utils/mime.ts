export interface InferMimeOptions {
  /**
   * MIME type to return when extension is DynamicValue.
   *
   * Defaults to 'application/octet-stream'.
   */
  fallback?: string
}

export function inferMimeFromPath(path: string, options: InferMimeOptions = {}): string {
  const fallback = options.fallback ?? 'application/octet-stream'
  const lower = path.toLowerCase()

  // Images
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'

  // Video
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'

  // Audio
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  if (lower.endsWith('.pcm')) return 'audio/pcm'

  return fallback
}

