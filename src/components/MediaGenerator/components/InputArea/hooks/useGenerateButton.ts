import { useMemo } from 'react'

interface UseGenerateButtonProps {
  input: string
  uploadedImages: string[]
  isLoading: boolean
  isGenerating?: boolean
  currentModel: any
  selectedModel: string
  isQwenImageEdit: boolean
}

/**
 * 生成按钮 Hook
 * 处理生成按钮的状态和禁用逻辑
 */
export const useGenerateButton = ({
  input,
  uploadedImages,
  isLoading,
  isGenerating,
  currentModel,
  selectedModel,
  isQwenImageEdit
}: UseGenerateButtonProps) => {
  // 计算生成按钮是否禁用
  const isGenerateDisabled = useMemo(() => {
    if (isLoading) return true

    // Qwen-Image-Edit-2509 必须同时有提示词和图片
    if (isQwenImageEdit) {
      return !input.trim() || uploadedImages.length === 0
    }

    // KIE Hailuo 2.3 必须同时有提示词和图片
    if (selectedModel === 'kie-hailuo-2-3' || selectedModel === 'hailuo-2-3-kie') {
      return !input.trim() || uploadedImages.length === 0
    }

    // 其他模型的逻辑
    return !input.trim() && (currentModel?.type !== 'audio' && uploadedImages.length === 0)
  }, [isLoading, isQwenImageEdit, input, uploadedImages.length, selectedModel, currentModel])

  // 按钮标题
  const buttonTitle = useMemo(() => {
    return isGenerating ? '加入队列' : '开始生成'
  }, [isGenerating])

  // 按钮样式
  const buttonClassName = useMemo(() => {
    const baseClass = 'absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300'

    if (isGenerateDisabled) {
      return `${baseClass} bg-zinc-700/50 text-zinc-500 cursor-not-allowed`
    }

    return `${baseClass} bg-[#007eff] hover:brightness-110 text-white shadow-lg hover:shadow-xl transform hover:scale-105`
  }, [isGenerateDisabled])

  return {
    isGenerateDisabled,
    buttonTitle,
    buttonClassName
  }
}
