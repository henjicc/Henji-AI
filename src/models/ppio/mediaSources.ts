export type PpioModelParams = DynamicValueMap

function filterMediaSources(values: DynamicValue): string[] {
  return Array.isArray(values)
    ? values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function resolvePreferredSources(primary: DynamicValue, fallback: DynamicValue): string[] {
  const preferred = filterMediaSources(primary)
  return preferred.length > 0 ? preferred : filterMediaSources(fallback)
}

export function resolvePpioImageSources(params: PpioModelParams): string[] {
  return resolvePreferredSources(params.uploadedFilePaths, params.images)
}

export function resolvePpioVideoSources(params: PpioModelParams): string[] {
  return resolvePreferredSources(params.uploadedVideoFilePaths, params.videos)
}

export function resolvePpioPrimaryVideoSource(params: PpioModelParams): string | undefined {
  const preferred = resolvePpioVideoSources(params)
  if (preferred.length > 0) {
    return preferred[0]
  }

  const legacyVideo = params.video
  return typeof legacyVideo === 'string' && legacyVideo.trim().length > 0
    ? legacyVideo
    : undefined
}
