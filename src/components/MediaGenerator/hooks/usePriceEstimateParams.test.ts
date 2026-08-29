import { describe, expect, it } from 'vitest'

import {
  buildPriceEstimateParams,
  resolvePriceEstimateVideoDuration,
  type PriceEstimateParamsInput,
} from './usePriceEstimateParams'

const baseInput: PriceEstimateParamsInput = {
  modelParams: {
    duration: 5,
    images: ['stale-image'],
    videos: ['stale-video'],
    audios: ['stale-audio'],
    uploadedImages: ['stale-uploaded-image'],
  },
  prompt: '实时提示词',
  uploadedImages: ['image-1', 'image-2'],
  uploadedFilePaths: ['/local/image-1.png', '/local/image-2.png'],
  uploadedVideos: ['video-1'],
  uploadedVideoFilePaths: ['/local/video-1.mp4'],
  uploadedAudios: ['audio-1'],
  uploadedAudioFilePaths: ['/local/audio-1.wav'],
  uploadedVideoDuration: 12,
  uploadedVideoTrimStart: 2,
  uploadedVideoTrimEnd: 7,
}

describe('price estimate params', () => {
  it('使用实时媒体状态覆盖模型参数，并传入裁剪后的首视频时长', () => {
    expect(buildPriceEstimateParams(baseInput)).toMatchObject({
      duration: 5,
      prompt: '实时提示词',
      text: '实时提示词',
      images: ['image-1', 'image-2'],
      uploadedImages: ['image-1', 'image-2'],
      uploadedFilePaths: ['/local/image-1.png', '/local/image-2.png'],
      videos: ['video-1'],
      uploadedVideos: ['video-1'],
      uploadedVideoFilePaths: ['/local/video-1.mp4'],
      audios: ['audio-1'],
      uploadedAudios: ['audio-1'],
      uploadedAudioFilePaths: ['/local/audio-1.wav'],
      uploadedVideoDuration: 12,
      __firstVideoDurationSeconds: 5,
      __videoDurationSeconds: [5],
      __totalVideoDurationSeconds: 5,
    })
  })

  it('新上传素材尚无本地路径时，仍通过实时别名传给计价器', () => {
    const params = buildPriceEstimateParams({
      ...baseInput,
      uploadedImages: ['fresh-image-1', 'fresh-image-2'],
      uploadedFilePaths: [],
      uploadedVideos: ['fresh-video'],
      uploadedVideoFilePaths: [],
      uploadedAudios: ['fresh-audio'],
      uploadedAudioFilePaths: [],
    })

    expect(params).toMatchObject({
      images: ['fresh-image-1', 'fresh-image-2'],
      uploadedImages: ['fresh-image-1', 'fresh-image-2'],
      uploadedFilePaths: [],
      videos: ['fresh-video'],
      uploadedVideos: ['fresh-video'],
      uploadedVideoFilePaths: [],
      audios: ['fresh-audio'],
      uploadedAudios: ['fresh-audio'],
      uploadedAudioFilePaths: [],
    })
  })

  it('未裁剪时使用已知的首视频时长，无有效时长时不臆造', () => {
    expect(resolvePriceEstimateVideoDuration({
      ...baseInput,
      uploadedVideoTrimStart: null,
      uploadedVideoTrimEnd: null,
    })).toBe(12)
    expect(resolvePriceEstimateVideoDuration({
      ...baseInput,
      uploadedVideoDuration: 0,
      uploadedVideoTrimStart: null,
      uploadedVideoTrimEnd: null,
    })).toBeUndefined()
  })

  it('多个视频仅在拿到完整逐段时长时提供精确总时长', () => {
    expect(buildPriceEstimateParams({
      ...baseInput,
      uploadedVideos: ['video-1', 'video-2'],
      uploadedVideoFilePaths: ['/local/video-1.mp4', '/local/video-2.mp4'],
      uploadedVideoDurations: [3, 8],
      uploadedVideoTrimStart: null,
      uploadedVideoTrimEnd: null,
    })).toMatchObject({
      __firstVideoDurationSeconds: 12,
      __videoDurationSeconds: [3, 8],
      __totalVideoDurationSeconds: 11,
    })

    const incomplete = buildPriceEstimateParams({
      ...baseInput,
      uploadedVideos: ['video-1', 'video-2'],
      uploadedVideoFilePaths: ['/local/video-1.mp4', '/local/video-2.mp4'],
      uploadedVideoDurations: [3],
      uploadedVideoTrimStart: null,
      uploadedVideoTrimEnd: null,
    })
    expect(incomplete.__videoDurationSeconds).toBeUndefined()
    expect(incomplete.__totalVideoDurationSeconds).toBeUndefined()
    expect(incomplete.__firstVideoDurationSeconds).toBe(12)
  })
})
