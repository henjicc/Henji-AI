import { readVideoInfo } from '@/commands/video'

export type VideoDurationReader = (videoSource: string) => Promise<number | null>

function isStringArray(value: DynamicValue): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function resolveGenerationVideoSources(params: DynamicValueMap): string[] {
  const candidates: DynamicValue[] = [params.uploadedVideoFilePaths, params.videos, params.uploadedVideos]
  let resolved: string[] = []
  for (const candidate of candidates) {
    if (!isStringArray(candidate)) continue
    const sources = candidate.filter((item) => item.trim().length > 0)
    if (sources.length > resolved.length) resolved = sources
  }
  return resolved
}

async function readVideoDurationSeconds(videoSource: string): Promise<number | null> {
  try {
    const info = await readVideoInfo(videoSource)
    return info.durationSeconds > 0 ? info.durationSeconds : null
  } catch {
    return null
  }
}

/**
 * request.builder 无法自行读取本地视频元数据；生成提交前在宿主侧补齐逐段、总时长，
 * 同时保留首段字段给仍需要单视频截取时长的旧模型。
 */
export async function attachVideoDurations(
  params: DynamicValueMap,
  readDuration: VideoDurationReader = readVideoDurationSeconds
): Promise<DynamicValueMap> {
  const videoSources = resolveGenerationVideoSources(params)
  if (videoSources.length === 0) {
    const next = { ...params }
    delete next.__firstVideoDurationSeconds
    delete next.__videoDurationSeconds
    delete next.__totalVideoDurationSeconds
    return next
  }

  const existingDurations = Array.isArray(params.__videoDurationSeconds)
    ? params.__videoDurationSeconds.filter((value): value is number => (
      typeof value === 'number' && Number.isFinite(value) && value > 0
    ))
    : []
  const durations = existingDurations.length === videoSources.length
    ? existingDurations
    : await Promise.all(videoSources.map(readDuration))
  const next = { ...params }
  const firstDuration = durations[0]
  if (typeof firstDuration === 'number' && firstDuration > 0) {
    next.__firstVideoDurationSeconds = firstDuration
  } else {
    delete next.__firstVideoDurationSeconds
  }

  if (durations.every((duration): duration is number => typeof duration === 'number' && duration > 0)) {
    next.__videoDurationSeconds = durations
    next.__totalVideoDurationSeconds = durations.reduce((total, duration) => total + duration, 0)
  } else {
    delete next.__videoDurationSeconds
    delete next.__totalVideoDurationSeconds
  }
  return next
}
