export type KieModelParams = DynamicValueMap

function filterMediaSources(values: DynamicValue): string[] {
  return Array.isArray(values)
    ? values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function resolvePreferredSources(primary: DynamicValue, fallback: DynamicValue): string[] {
  const preferred = filterMediaSources(primary)
  return preferred.length > 0 ? preferred : filterMediaSources(fallback)
}

export function resolveKieImageSources(params: KieModelParams): string[] {
  return resolvePreferredSources(params.uploadedFilePaths, params.images)
}

export function resolveKieVideoSources(params: KieModelParams): string[] {
  return resolvePreferredSources(params.uploadedVideoFilePaths, params.videos)
}

export function resolveKiePrimaryVideoSource(params: KieModelParams): string | undefined {
  const preferred = resolveKieVideoSources(params)
  if (preferred.length > 0) {
    return preferred[0]
  }

  const legacyVideo = params.video
  return typeof legacyVideo === 'string' && legacyVideo.trim().length > 0
    ? legacyVideo
    : undefined
}
