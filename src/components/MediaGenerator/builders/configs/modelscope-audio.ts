/**
 * 魔搭模型和音频模型配置
 */

import { ModelConfig, BuildContext } from '../core/types'

/**
 * 通用的本地文件路径保存处理器
 * 用于保存上传图片的本地路径，以便历史记录恢复和重新编辑
 *
 * 注意：魔搭模型在 API 调用时使用 data URL，但仍需要保存本地文件路径用于历史记录
 */
const commonImageUploadHandler = {
  afterBuild: async (options: Record<string, any>, context: BuildContext) => {
    if (context.uploadedImages.length === 0) {
      return
    }

    const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
    const setUploadedFilePaths = (context.params as any).setUploadedFilePaths
    const uploadedFilePaths = (context.params as any).uploadedFilePaths || []

    const paths: string[] = [...uploadedFilePaths]

    // 保存每张图片到本地，记录文件路径
    for (let i = 0; i < context.uploadedImages.length; i++) {
      if (!paths[i]) {
        const blob = await dataUrlToBlob(context.uploadedImages[i])
        const saved = await saveUploadImage(blob, 'persist')
        paths[i] = saved.fullPath
      }
    }

    setUploadedFilePaths(paths)
    options.uploadedFilePaths = paths
  }
}

/**
 * 魔搭通用图片模型配置
 * 适用于：Qwen/Qwen-Image, black-forest-labs/FLUX.1-Krea-dev,
 * MusePublic/14_ckpt_SD_XL, MusePublic/majicMIX_realistic
 */
export const modelscopeCommonConfig: ModelConfig = {
  id: 'modelscope-common',
  type: 'image',
  provider: 'modelscope',

  paramMapping: {
    size: {
      source: 'size',
      defaultValue: '1024x1024'
    },
    num_images: {
      source: ['numImages'],
      defaultValue: 1
    },
    guidance_scale: 'guidanceScale',
    num_inference_steps: 'numInferenceSteps',
    seed: 'seed',
    negative_prompt: 'negativePrompt'
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * 魔搭 Z-Image Turbo 配置（无 guidance_scale）
 */
export const modelscopeZImageTurboConfig: ModelConfig = {
  id: 'Tongyi-MAI/Z-Image-Turbo',
  type: 'image',
  provider: 'modelscope',

  paramMapping: {
    size: {
      source: 'size',
      defaultValue: '1024x1024'
    },
    num_images: {
      source: ['numImages'],
      defaultValue: 1
    },
    num_inference_steps: 'numInferenceSteps',
    seed: 'seed',
    negative_prompt: 'negativePrompt'
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Qwen Image Edit 2509 配置（支持最多3张图片）
 */
export const qwenImageEdit2509Config: ModelConfig = {
  id: 'Qwen/Qwen-Image-Edit-2509',
  type: 'image',
  provider: 'modelscope',

  paramMapping: {
    size: {
      source: 'size',
      defaultValue: '1024x1024'
    },
    num_images: {
      source: ['numImages'],
      defaultValue: 1
    },
    guidance_scale: 'guidanceScale',
    num_inference_steps: 'numInferenceSteps',
    seed: 'seed',
    negative_prompt: 'negativePrompt'
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 3,
      mode: 'multiple',
      paramKey: 'image_urls',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * 魔搭自定义模型配置
 */
export const modelscopeCustomConfig: ModelConfig = {
  id: 'modelscope-custom',
  type: 'image',
  provider: 'modelscope',

  paramMapping: {
    model: 'modelscopeCustomModel',
    size: {
      source: 'size',
      defaultValue: '1024x1024'
    },
    num_images: {
      source: ['numImages'],
      defaultValue: 1
    },
    guidance_scale: 'guidanceScale',
    num_inference_steps: 'numInferenceSteps',
    seed: 'seed',
    negative_prompt: 'negativePrompt'
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}

/**
 * Minimax Speech 2.6 配置（音频模型）
 */
export const minimaxSpeech26Config: ModelConfig = {
  id: 'minimax-speech-2.6',
  type: 'audio',
  provider: 'ppio',

  paramMapping: {
    speed: 'minimaxAudioSpeed',
    emotion: 'minimaxAudioEmotion',
    minimaxVoiceId: 'minimaxVoiceId',
    output_format: {
      source: 'output_format',
      defaultValue: 'url'
    },
    spec: 'minimaxAudioSpec',
    vol: 'minimaxAudioVol',
    pitch: 'minimaxAudioPitch',
    sample_rate: 'minimaxAudioSampleRate',
    bitrate: 'minimaxAudioBitrate',
    format: 'minimaxAudioFormat',
    channel: 'minimaxAudioChannel',
    latex_read: 'minimaxLatexRead',
    text_normalization: 'minimaxTextNormalization',
    language_boost: 'minimaxLanguageBoost'
  }
}
