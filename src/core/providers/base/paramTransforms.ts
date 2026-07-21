export type MediaValue = string | File

export const DEFAULT_INTERNAL_PROVIDER_FIELDS: ReadonlyArray<string> = [
  'images',
  'videos',
  'uploadedImages',
  'uploadedVideos',
  'uploadedFilePaths',
  'uploadedVideoFilePaths',
  'editStateFile',
  'imageEditStates',
  'video',
]

/**
 * Recursively traverses an object and transforms values for specific keys.
 *
 * This is mainly used to upload/convert media values (File/local path/data URI)
 * into remote URLs before sending the API request.
 */
export async function transformMediaFields(
  target: DynamicValueMap,
  keys: Set<string>,
  transformer: (value: MediaValue) => Promise<string>
): Promise<void> {
  const entries = Object.entries(target)

  for (const [key, rawValue] of entries) {
    if (
      rawValue &&
      typeof rawValue === 'object' &&
      !Array.isArray(rawValue) &&
      !(rawValue instanceof File)
    ) {
      await transformMediaFields(rawValue as DynamicValueMap, keys, transformer)
      continue
    }

    if (!keys.has(key)) continue

    if (Array.isArray(rawValue)) {
      const converted: string[] = []
      for (const item of rawValue) {
        if (typeof item === 'string' || item instanceof File) {
          converted.push(await transformer(item))
        }
      }
      target[key] = converted
      continue
    }

    if (typeof rawValue === 'string' || rawValue instanceof File) {
      target[key] = await transformer(rawValue)
    }
  }
}

export function stripInternalFields(
  params: DynamicValueMap,
  fields: ReadonlyArray<string> = DEFAULT_INTERNAL_PROVIDER_FIELDS
): void {
  for (const key of fields) {
    if (key in params) delete params[key]
  }
}

