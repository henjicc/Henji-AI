import { useMemo } from 'react'

export interface PriceEstimateParamsInput {
  modelParams: DynamicValueMap
  prompt: string
  uploadedImages: string[]
  uploadedFilePaths: string[]
  uploadedVideos: string[]
  uploadedVideoFilePaths: string[]
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
    __firstVideoDurationSeconds: resolvePriceEstimateVideoDuration(input),
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
    uploadedAudios,
    uploadedAudioFilePaths,
    uploadedVideoDuration,
    uploadedVideoTrimStart,
    uploadedVideoTrimEnd,
  ])
}
