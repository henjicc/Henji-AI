import { useMemo } from 'react'
import { getMaxImageCount } from '../../../utils/constants'

interface UseModelConfigProps {
  selectedModel: string
  currentModel: any
  viduMode?: string
  veoMode?: string
  klingMode?: string
  mode?: string
  seedanceMode?: string
  viduQ2Mode?: string
  hailuo02FastMode?: boolean
  kieSeedanceV3Version?: string
  ppioKlingO1Mode?: string
  ppioKling26Mode?: string
  kieKlingV26Mode?: string
  falKlingV26ProMode?: string
  ppioWan26Mode?: string
  modelscopeCustomModel?: string
}

/**
 * 模型配置 Hook
 * 处理模型特定的配置和限制
 */
export const useModelConfig = ({
  selectedModel,
  currentModel,
  viduMode,
  veoMode,
  klingMode,
  mode,
  seedanceMode,
  viduQ2Mode,
  hailuo02FastMode,
  kieSeedanceV3Version,
  ppioKlingO1Mode,
  ppioKling26Mode,
  kieKlingV26Mode,
  falKlingV26ProMode,
  ppioWan26Mode,
  modelscopeCustomModel
}: UseModelConfigProps) => {
  // 计算最大图片数
  const maxImageCount = useMemo(() => {
    return getMaxImageCount(
      selectedModel,
      selectedModel === 'vidu-q1' ? viduMode :
        (selectedModel === 'veo3.1' || selectedModel === 'fal-ai-veo-3.1') ? veoMode :
          (selectedModel === 'fal-ai-bytedance-seedance-v1' || selectedModel === 'bytedance-seedance-v1') ? seedanceMode :
            (selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') ? viduQ2Mode :
              (selectedModel === 'fal-ai-minimax-hailuo-02' || selectedModel === 'minimax-hailuo-02-fal') && hailuo02FastMode ? 'fast' :
                (selectedModel === 'kie-seedance-v3' || selectedModel === 'seedance-v3-kie') ? kieSeedanceV3Version :
                  undefined
    )
  }, [selectedModel, viduMode, veoMode, seedanceMode, viduQ2Mode, hailuo02FastMode, kieSeedanceV3Version])

  // 是否允许多选
  const isMultiple = useMemo(() => {
    return (selectedModel === 'vidu-q1' && viduMode === 'reference-to-video') ||
      selectedModel === 'minimax-hailuo-02' ||
      (selectedModel === 'veo3.1' && veoMode === 'reference-to-video') ||
      ((selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') && viduQ2Mode === 'reference-to-video') ||
      (selectedModel !== 'kling-2.5-turbo' &&
        selectedModel !== 'minimax-hailuo-2.3' &&
        selectedModel !== 'wan-2.5-preview')
  }, [selectedModel, viduMode, veoMode, viduQ2Mode])

  // 检查是否是魔搭模型
  const isModelscopeModel = useMemo(() => {
    return selectedModel === 'Tongyi-MAI/Z-Image-Turbo' ||
      selectedModel === 'Qwen/Qwen-Image' ||
      selectedModel === 'black-forest-labs/FLUX.1-Krea-dev' ||
      selectedModel === 'MusePublic/14_ckpt_SD_XL' ||
      selectedModel === 'MusePublic/majicMIX_realistic'
  }, [selectedModel])

  // 检查自定义模型是否支持图片编辑
  const isModelscopeCustomWithImageEditing = useMemo(() => {
    if (selectedModel !== 'modelscope-custom' || !modelscopeCustomModel) {
      return false
    }

    try {
      const stored = localStorage.getItem('modelscope_custom_models')
      if (stored) {
        const models = JSON.parse(stored)
        const currentModel = models.find((m: any) => m.id === modelscopeCustomModel)
        if (currentModel && currentModel.modelType) {
          return currentModel.modelType.imageEditing === true
        }
      }
    } catch (e) {
      console.error('Failed to check custom model type:', e)
    }
    return false
  }, [selectedModel, modelscopeCustomModel])

  // 检查是否是 Qwen-Image-Edit-2509
  const isQwenImageEdit = useMemo(() => {
    return selectedModel === 'Qwen/Qwen-Image-Edit-2509'
  }, [selectedModel])

  // 是否显示图片上传
  const shouldShowImageUpload = useMemo(() => {
    return currentModel?.type !== 'audio' &&
      selectedModel !== 'fal-ai-z-image-turbo' &&
      selectedModel !== 'kie-grok-imagine' &&
      selectedModel !== 'grok-imagine-kie' &&
      !isModelscopeModel &&
      !(selectedModel === 'modelscope-custom' && !isModelscopeCustomWithImageEditing)
  }, [currentModel, selectedModel, isModelscopeModel, isModelscopeCustomWithImageEditing])

  // 文本框占位符
  const placeholder = useMemo(() => {
    if (currentModel?.type === 'audio') {
      return '输入要合成的文本'
    }
    if (selectedModel === 'kie-grok-imagine-video' ||
        selectedModel === 'grok-imagine-video-kie' ||
        selectedModel === 'black-forest-labs/FLUX.1-Krea-dev') {
      return '描述想要生成的内容（仅支持英文提示词）'
    }
    return '描述想要生成的内容'
  }, [currentModel, selectedModel])

  // 文本框高度
  const textareaHeight = useMemo(() => {
    if (currentModel?.type === 'audio' ||
        selectedModel === 'fal-ai-z-image-turbo' ||
        selectedModel === 'kie-grok-imagine' ||
        selectedModel === 'grok-imagine-kie' ||
        isModelscopeModel ||
        (selectedModel === 'modelscope-custom' && !isModelscopeCustomWithImageEditing)) {
      return 'min-h-[176px]'
    }
    return 'min-h-[100px]'
  }, [currentModel, selectedModel, isModelscopeModel, isModelscopeCustomWithImageEditing])

  return {
    maxImageCount,
    isMultiple,
    isModelscopeModel,
    isModelscopeCustomWithImageEditing,
    isQwenImageEdit,
    shouldShowImageUpload,
    placeholder,
    textareaHeight
  }
}
