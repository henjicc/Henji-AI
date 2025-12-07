/**
 * 根据模型ID获取对应的参数值
 * 用于解决不同供应商相同模型的参数冲突问题
 */

interface ModelParamsGetter {
  getVideoDuration: (state: any, modelId: string) => number
  getVideoAspectRatio: (state: any, modelId: string) => string
  getVideoResolution: (state: any, modelId: string) => string
  getAspectRatio: (state: any, modelId: string) => string
  getNumImages: (state: any, modelId: string) => number
  getImageSize: (state: any, modelId: string) => string
}

export const modelParamsGetter: ModelParamsGetter = {
  getVideoDuration: (state, modelId) => {
    switch (modelId) {
      case 'kling-2.5-turbo':
        return state.ppioKling25VideoDuration ?? state.videoDuration
      case 'minimax-hailuo-2.3':
        return state.ppioHailuo23VideoDuration ?? state.videoDuration
      case 'wan-2.5-preview':
        return state.ppioWan25VideoDuration ?? state.videoDuration
      case 'seedance-v1':
        return state.ppioSeedanceV1VideoDuration ?? state.videoDuration
      case 'fal-ai-wan-25-preview':
      case 'wan-25-preview':
        return state.falWan25VideoDuration ?? state.videoDuration
      case 'fal-ai-bytedance-seedance-v1':
        return state.falSeedanceV1VideoDuration ?? state.videoDuration
      case 'fal-ai-veo-3.1':
        return state.falVeo31VideoDuration ?? state.videoDuration
      case 'fal-ai-sora-2':
        return state.falSora2VideoDuration ?? state.videoDuration
      case 'fal-ai-ltx-2':
        return state.falLtx2VideoDuration ?? state.videoDuration
      case 'fal-ai-vidu-q2':
        return state.falViduQ2VideoDuration ?? state.videoDuration
      case 'fal-ai-pixverse-v5.5':
        return state.falPixverse55VideoDuration ?? state.videoDuration
      case 'fal-ai-kling-video-v2.6-pro':
        return state.falKlingV26ProVideoDuration ?? state.videoDuration
      default:
        return state.videoDuration
    }
  },

  getVideoAspectRatio: (state, modelId) => {
    switch (modelId) {
      case 'kling-2.5-turbo':
        return state.ppioKling25VideoAspectRatio ?? state.videoAspectRatio
      case 'pixverse-v4.5':
        return state.ppioPixverse45VideoAspectRatio ?? state.videoAspectRatio
      default:
        return state.videoAspectRatio
    }
  },

  getVideoResolution: (state, modelId) => {
    switch (modelId) {
      case 'minimax-hailuo-2.3':
        return state.ppioHailuo23VideoResolution ?? state.videoResolution
      case 'pixverse-v4.5':
        return state.ppioPixverse45VideoResolution ?? state.videoResolution
      default:
        return state.videoResolution
    }
  },

  getAspectRatio: (state, modelId) => {
    switch (modelId) {
      case 'fal-ai-nano-banana':
        return state.falNanoBananaAspectRatio ?? state.aspectRatio
      case 'fal-ai-nano-banana-pro':
        return state.falNanoBananaProAspectRatio ?? state.aspectRatio
      case 'fal-ai-kling-image-o1':
        return state.falKlingImageO1AspectRatio ?? state.aspectRatio
      default:
        return state.aspectRatio
    }
  },

  getNumImages: (state, modelId) => {
    switch (modelId) {
      case 'fal-ai-nano-banana':
        return state.falNanoBananaNumImages ?? state.numImages
      case 'fal-ai-nano-banana-pro':
        return state.falNanoBananaProNumImages ?? state.numImages
      case 'fal-ai-kling-image-o1':
        return state.falKlingImageO1NumImages ?? state.numImages
      case 'fal-ai-z-image-turbo':
        return state.falZImageTurboNumImages ?? state.numImages
      case 'fal-ai-bytedance-seedream-v4':
        return state.falSeedream40NumImages ?? state.numImages
      default:
        return state.numImages
    }
  },

  getImageSize: (state, modelId) => {
    switch (modelId) {
      case 'fal-ai-z-image-turbo':
        return state.falZImageTurboImageSize ?? state.imageSize
      default:
        return state.imageSize
    }
  }
}
