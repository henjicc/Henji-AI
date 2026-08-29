import { useMemo } from 'react'

export interface PriceEstimateParamsInput {
  modelParams: DynamicValueMap
  prompt: string
  uploadedImages: string[]
  uploadedFilePaths: string[]
  uploadedVideos: string[]
  uploadedVideoFilePaths: string[]
  uploadedVideoDurations?: number[]
  uploadedAudios: string[]
  uploadedAudioFilePaths: string[]
  uploadedVideoDuration: number
  uploadedVideoTrimStart: number | null
  uploadedVideoTrimEnd: number | null
}

export function resolvePriceEstimateVideoDuration(
  input: Pick<
    PriceEstimateParamsInput,
    'uploadedVideoDuration' | 'uploadedVideoTrimStart' | 'uploadedVideoTrimEnd'
  >
): number | undefined {
  const { uploadedVideoDuration, uploadedVideoTrimStart, uploadedVideoTrimEnd } = input
  if (
    typeof uploadedVideoTrimStart === 'number' &&
    typeof uploadedVideoTrimEnd === 'number' &&
    Number.isFinite(uploadedVideoTrimStart) &&
    Number.isFinite(uploadedVideoTrimEnd) &&
    uploadedVideoTrimEnd > uploadedVideoTrimStart
  ) {
    return uploadedVideoTrimEnd - uploadedVideoTrimStart
  }

  return Number.isFinite(uploadedVideoDuration) && uploadedVideoDuration > 0
    ? uploadedVideoDuration
    : undefined
}

export function buildPriceEstimateParams(input: PriceEstimateParamsInput): DynamicValueMap {
  const firstVideoDuration = resolvePriceEstimateVideoDuration(input)
  const videoCount = Math.max(input.uploadedVideos.length, input.uploadedVideoFilePaths.length)
  const providedDurations = input.uploadedVideoDurations?.filter(
    (duration) => Number.isFinite(duration) && duration > 0
  ) ?? []
  const videoDurations = providedDurations.length === videoCount
    ? providedDurations
    : (videoCount === 1 && firstVideoDuration !== undefined ? [firstVideoDuration] : undefined)

  return {
    ...input.modelParams,
    prompt: input.prompt,
    text: input.prompt,
    images: input.uploadedImages,
    uploadedImages: input.uploadedImages,
    uploadedFilePaths: input.uploadedFilePaths,
    videos: input.uploadedVideos,
    uploadedVideos: input.uploadedVideos,
    uploadedVideoFilePaths: input.uploadedVideoFilePaths,
    audios: input.uploadedAudios,
    uploadedAudios: input.uploadedAudios,
    uploadedAudioFilePaths: input.uploadedAudioFilePaths,
    uploadedVideoDuration: input.uploadedVideoDuration,
    uploadedVideoTrimStart: input.uploadedVideoTrimStart,
    uploadedVideoTrimEnd: input.uploadedVideoTrimEnd,
    __firstVideoDurationSeconds: firstVideoDuration,
    __videoDurationSeconds: videoDurations,
    __totalVideoDurationSeconds: videoDurations?.reduce((total, duration) => total + duration, 0),
  }
}

export function usePriceEstimateParams(input: PriceEstimateParamsInput): DynamicValueMap {
  const {
    modelParams,
    prompt,
    uploadedImages,
    uploadedFilePaths,
    uploadedVideos,
    uploadedVideoFilePaths,
    uploadedVideoDurations,
    uploadedAudios,
    uploadedAudioFilePaths,
    uploadedVideoDuration,
    uploadedVideoTrimStart,
    uploadedVideoTrimEnd,
  } = input

  return useMemo(() => buildPriceEstimateParams({
    modelParams,
    prompt,
    uploadedImages,
    uploadedFilePaths,
    uploadedVideos,
    uploadedVideoFilePaths,
    uploadedVideoDurations,
    uploadedAudios,
    uploadedAudioFilePaths,
    uploadedVideoDuration,
    uploadedVideoTrimStart,
    uploadedVideoTrimEnd,
  }), [
    modelParams,
    prompt,
    uploadedImages,
    uploadedFilePaths,
    uploadedVideos,
    uploadedVideoFilePaths,
    uploadedVideoDurations,
    uploadedAudios,
    uploadedAudioFilePaths,
    uploadedVideoDuration,
    uploadedVideoTrimStart,
    uploadedVideoTrimEnd,
  ])
}
