/**
 * 魔搭模型和音频模型配置
 */

import { ModelConfig, BuildContext } from '../core/types'
import { logError, logInfo } from '../../../../utils/errorLogger'

/**
 * 检查模型是否支持图片编辑
 * @param selectedModel 当前选中的模型 ID
 * @param modelscopeCustomModel 自定义模型 ID（如果有）
 * @returns 是否支持图片编辑
 */
const checkModelSupportsImageEditing = (selectedModel: string, modelscopeCustomModel?: string): boolean => {
  // 1. 对于自定义模型，检查 modelType.imageEditing
  if (modelscopeCustomModel) {
    try {
      const stored = localStorage.getItem('modelscope_custom_models')
      if (stored) {
        const models = JSON.parse(stored)
        const currentModel = models.find((m: any) => m.id === modelscopeCustomModel)

        // 如果找到模型配置，检查是否支持图片编辑
        if (currentModel && currentModel.modelType) {
          return currentModel.modelType.imageEditing === true
        }
      }
    } catch (e) {
      logError('[ModelScope] 检查自定义模型类型失败:', e)
    }
  }

  // 2. 对于预设模型，根据模型 ID 判断
  // 只有 Qwen-Image-Edit-2509 支持图片编辑
  // 其他预设模型（Z-Image-Turbo, Qwen-Image, FLUX.1-Krea-dev 等）只支持图片生成
  const imageEditingModels = [
    'Qwen/Qwen-Image-Edit-2509'
  ]

  return imageEditingModels.includes(selectedModel)
}

/**
 * 通用的本地文件路径保存处理器
 * 用于保存上传图片的本地路径，以便历史记录恢复和重新编辑
 *
 * 注意：魔搭模型需要将图片上传到 Fal CDN 获取 URL
 * 1. 设置 options.images（data URL 格式）
 * 2. ModelscopeAdapter 会检测并自动上传到 Fal CDN
 * 3. 上传成功后，adapter 会将 imageUrls 传递给模型路由
 */
const commonImageUploadHandler = {
  afterBuild: async (options: Record<string, any>, context: BuildContext) => {
    if (context.uploadedImages.length === 0) {
      return
    }

    const params = context.params
    const selectedModel = (params as any).selectedModel
    const modelscopeCustomModel = (params as any).modelscopeCustomModel

    // 检查当前模型是否支持图片功能（图片编辑或图生图）
    const supportsImageFeature = checkModelSupportsImageEditing(selectedModel, modelscopeCustomModel)

    // 注意：即使模型不支持图片编辑，也可能支持图生图功能
    // 因此我们总是尝试上传图片，让 adapter 和 API 决定如何处理
    if (!supportsImageFeature) {
      logInfo('[ModelScope] 当前模型可能不支持图片编辑，但仍尝试上传图片（支持图生图）:', selectedModel)
    }

    const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')
    const setUploadedFilePaths = (params as any).setUploadedFilePaths
    const uploadedFilePaths = (params as any).uploadedFilePaths || []

    // 重要：设置 images 参数，让 ModelscopeAdapter 检测并上传到 Fal CDN
    options.images = context.uploadedImages

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

    // 处理智能分辨率计算（保持原图比例）
    const modelscopeImageSize = (params as any).modelscopeImageSize

    if (modelscopeImageSize === 'smart' && context.uploadedImages.length > 0) {
      try {
        // 使用 Qwen 专用智能分辨率计算器
        const { smartMatchQwenResolution } = await import('@/utils/qwenResolutionCalculator')

        // 从第一张图片获取尺寸
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
          img.src = context.uploadedImages[0]
        })

        // 计算最佳分辨率（保持原图比例）
        const resolution = smartMatchQwenResolution(img.width, img.height)

        // 设置计算后的宽高
        options.width = resolution.width
        options.height = resolution.height

        logInfo('[ModelScope] 智能分辨率计算:', {
          原图尺寸: `${img.width}x${img.height}`,
          原图比例: (img.width / img.height).toFixed(4),
          计算结果: `${resolution.width}x${resolution.height}`,
          结果比例: (resolution.width / resolution.height).toFixed(4),
          比例偏差: Math.abs((img.width / img.height) - (resolution.width / resolution.height)).toFixed(6)
        })
      } catch (error) {
        logError('[ModelScope] 智能分辨率计算失败:', error)
        // 失败时使用默认分辨率 1024x1024
        options.width = 1024
        options.height = 1024
      }
    }
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
    // 宽度参数（路由期望 width）
    width: 'customWidth',
    // 高度参数（路由期望 height）
    height: 'customHeight',
    // 采样步数（路由期望 steps）
    steps: 'modelscopeSteps',
    // 提示词引导系数（路由期望 guidance）
    guidance: 'modelscopeGuidance',
    // 负面提示词（路由期望 negativePrompt）
    negativePrompt: 'modelscopeNegativePrompt',
    // 随机种子
    seed: 'seed'
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
 * 魔搭 Z-Image Turbo 配置（无 guidance 参数）
 */
export const modelscopeZImageTurboConfig: ModelConfig = {
  id: 'Tongyi-MAI/Z-Image-Turbo',
  type: 'image',
  provider: 'modelscope',

  paramMapping: {
    // 宽度参数（路由期望 width）
    width: 'customWidth',
    // 高度参数（路由期望 height）
    height: 'customHeight',
    // 采样步数（路由期望 steps）
    steps: 'modelscopeSteps',
    // 负面提示词（路由期望 negativePrompt）
    negativePrompt: 'modelscopeNegativePrompt',
    // 随机种子
    seed: 'seed'
    // 注意：Z-Image Turbo 不使用 guidance 参数
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
 * 注意：此模型不使用 negative_prompt 和 guidance 参数
 */
export const qwenImageEdit2509Config: ModelConfig = {
  id: 'Qwen/Qwen-Image-Edit-2509',
  type: 'image',
  provider: 'modelscope',

  paramMapping: {
    // 宽度参数（路由期望 width）
    width: 'customWidth',
    // 高度参数（路由期望 height）
    height: 'customHeight',
    // 采样步数（路由期望 steps）
    steps: 'modelscopeSteps',
    // 随机种子
    seed: 'seed'
    // 注意：Qwen-Image-Edit-2509 不使用 negative_prompt 和 guidance 参数（route 会自动过滤）
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
    // 模型 ID（路由期望 model）
    model: 'modelscopeCustomModel',
    // 宽度参数（路由期望 width）
    width: 'customWidth',
    // 高度参数（路由期望 height）
    height: 'customHeight',
    // 采样步数（路由期望 steps）
    steps: 'modelscopeSteps',
    // 提示词引导系数（路由期望 guidance）
    guidance: 'modelscopeGuidance',
    // 负面提示词（路由期望 negativePrompt）
    negativePrompt: 'modelscopeNegativePrompt',
    // 随机种子
    seed: 'seed'
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
