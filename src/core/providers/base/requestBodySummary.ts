/**
 * Request body summary helper for logging.
 *
 * - Filters internal fields that should never appear in logs.
 * - Replaces base64 payloads with a short, size-based placeholder.
 */

export const DEFAULT_INTERNAL_FIELDS_FOR_LOG: ReadonlyArray<string> = [
  'editStateFile',
  'uploadedFilePaths',
  'uploadedVideoFilePaths',
  'sourceFile',
  'maskFile',
]

export interface SummarizeRequestBodyOptions {
  internalFields?: ReadonlyArray<string>
}

export function summarizeRequestBody(
  body: DynamicValueMap,
  options: SummarizeRequestBodyOptions = {}
): DynamicValueMap {
  const internalFields = options.internalFields ?? DEFAULT_INTERNAL_FIELDS_FOR_LOG

  const summarized: DynamicValueMap = {}

  for (const [key, value] of Object.entries(body)) {
    // 1) Skip undefined (these won't be sent by JSON.stringify either)
    if (value === undefined) continue

    // 2) Skip internal fields
    if (internalFields.includes(key)) continue

    if (Array.isArray(value)) {
      summarized[key] = value.map((item) => {
        if (typeof item === 'string' && item.startsWith('data:')) {
          const mimeMatch = item.match(/^data:([^;]+);/)
          const mimeType = mimeMatch ? mimeMatch[1] : 'DynamicValue'
          const base64Part = item.split(',')[1] || ''
          const sizeKB = Math.round((base64Part.length * 3) / 4 / 1024)
          return `[BASE64 ${mimeType} ~${sizeKB}KB]`
        }
        return item
      })
      continue
    }

    if (typeof value === 'string' && value.startsWith('data:')) {
      const mimeMatch = value.match(/^data:([^;]+);/)
      const mimeType = mimeMatch ? mimeMatch[1] : 'DynamicValue'
      const base64Part = value.split(',')[1] || ''
      const sizeKB = Math.round((base64Part.length * 3) / 4 / 1024)
      summarized[key] = `[BASE64 ${mimeType} ~${sizeKB}KB]`
      continue
    }

    summarized[key] = value
  }

  return summarized
}

