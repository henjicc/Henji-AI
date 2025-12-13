import React from 'react'
import FileUploader from '@/components/ui/FileUploader'
import { getMaxImageCount } from '../utils/constants'
import { logError } from '../../../utils/errorLogger'

interface InputAreaProps {
  input: string
  setInput: (value: string) => void
  currentModel: any
  selectedModel: string
  uploadedImages: string[]
  isLoading: boolean
  isGenerating?: boolean

  // Vidu/Veo/Kling/LTX-2/Seedance/Vidu Q2 模式（用于计算最大图片数）
  viduMode?: string
  veoMode?: string
  klingMode?: string
  mode?: string  // LTX-2 模式
  seedanceMode?: string  // Seedance v1 模式
  viduQ2Mode?: string  // Vidu Q2 模式
  hailuo02FastMode?: boolean  // Hailuo 02 快速模式
  kieSeedanceV3Version?: string  // KIE Seedance V3 版本

  // 魔搭自定义模型 ID
  modelscopeCustomModel?: string

  // 图片处理回调
  onImageUpload: (files: File[]) => void
  onImageRemove: (index: number) => void
  onImageReplace: (index: number, file: File) => void
  onImageReorder: (from: number, to: number) => void
  onImageClick?: (imageUrl: string, imageList: string[]) => void
  onPaste: (e: React.ClipboardEvent) => void
  onImageDrop: (files: File[]) => void
  onDragStateChange: (isDragging: boolean) => void

  // 视频处理回调
  uploadedVideos?: string[]
  onVideoUpload?: (files: File[]) => void
  onVideoRemove?: (index: number) => void
  onVideoReplace?: (index: number, file: File) => void
  onVideoClick?: (videoUrl: string) => void

  // 生成回调
  onGenerate: () => void
}

/**
 * 输入区域组件
 * 包含图片上传和文本输入
 */
const InputArea: React.FC<InputAreaProps> = ({
  input,
  setInput,
  currentModel,
  selectedModel,
  uploadedImages,
  isLoading,
  isGenerating,
  viduMode,
  veoMode,
  klingMode,
  mode,
  seedanceMode,
  viduQ2Mode,
  hailuo02FastMode,
  kieSeedanceV3Version,
  modelscopeCustomModel,
  onImageUpload,
  onImageRemove,
  onImageReplace,
  onImageReorder,
  onImageClick,
  onPaste,
  onImageDrop,
  onDragStateChange,
  uploadedVideos = [],
  onVideoUpload,
  onVideoRemove,
  onVideoReplace,
  onVideoClick,
  onGenerate
}) => {
  // 计算最大图片数
  const maxImageCount = getMaxImageCount(
    selectedModel,
    selectedModel === 'vidu-q1' ? viduMode :
    (selectedModel === 'veo3.1' || selectedModel === 'fal-ai-veo-3.1') ? veoMode :
    (selectedModel === 'fal-ai-bytedance-seedance-v1' || selectedModel === 'bytedance-seedance-v1') ? seedanceMode :
    (selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') ? viduQ2Mode :
    (selectedModel === 'fal-ai-minimax-hailuo-02' || selectedModel === 'minimax-hailuo-02-fal') && hailuo02FastMode ? 'fast' :
    (selectedModel === 'kie-seedance-v3' || selectedModel === 'seedance-v3-kie') ? kieSeedanceV3Version :
    undefined
  )

  // 是否允许多选
  const isMultiple =
    (selectedModel === 'vidu-q1' && viduMode === 'reference-to-video') ||
    selectedModel === 'minimax-hailuo-02' ||
    (selectedModel === 'veo3.1' && veoMode === 'reference-to-video') ||
    ((selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') && viduQ2Mode === 'reference-to-video') ||
    (selectedModel !== 'kling-2.5-turbo' &&
     selectedModel !== 'minimax-hailuo-2.3' &&
     selectedModel !== 'wan-2.5-preview')

  // 检查是否是魔搭模型（不包括自定义模型，因为自定义模型需要单独判断）
  const isModelscopeModel =
    selectedModel === 'Tongyi-MAI/Z-Image-Turbo' ||
    selectedModel === 'Qwen/Qwen-Image' ||
    selectedModel === 'black-forest-labs/FLUX.1-Krea-dev' ||
    selectedModel === 'MusePublic/14_ckpt_SD_XL' ||
    selectedModel === 'MusePublic/majicMIX_realistic'

  // 检查自定义模型是否支持图片编辑
  const isModelscopeCustomWithImageEditing = selectedModel === 'modelscope-custom' && (() => {
    if (!modelscopeCustomModel) return false

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
      logError('Failed to check custom model type:', e)
    }
    return false
  })()

  // 检查是否是 Qwen-Image-Edit-2509
  const isQwenImageEdit = selectedModel === 'Qwen/Qwen-Image-Edit-2509'

  // 计算生成按钮是否禁用
  const isGenerateDisabled = () => {
    if (isLoading) return true

    // Qwen-Image-Edit-2509 必须同时有提示词和图片
    if (isQwenImageEdit) {
      return !input.trim() || uploadedImages.length === 0
    }

    // KIE Hailuo 2.3 必须同时有提示词和图片
    if (selectedModel === 'kie-hailuo-2-3' || selectedModel === 'hailuo-2-3-kie') {
      return !input.trim() || uploadedImages.length === 0
    }

    // 其他模型的逻辑保持不变
    return !input.trim() && (currentModel?.type !== 'audio' && uploadedImages.length === 0)
  }

  // 检查是否需要显示视频上传
  // 1. Kling Video O1 的视频编辑和视频参考模式（支持视频+图片）
  // 2. LTX-2 的视频编辑模式（仅支持视频）
  // 3. Vidu Q2 的视频延长模式（仅支持视频）
  const needsVideoUpload =
    ((selectedModel === 'fal-ai-kling-video-o1' || selectedModel === 'kling-video-o1') &&
     (klingMode === 'video-to-video-edit' || klingMode === 'video-to-video-reference')) ||
    ((selectedModel === 'fal-ai-ltx-2' || selectedModel === 'ltx-2') &&
     mode === 'retake-video') ||
    ((selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') &&
     viduQ2Mode === 'video-extension')

  // 检查是否只需要视频（LTX-2 视频编辑模式 和 Vidu Q2 视频延长模式）
  const needsVideoOnly =
    ((selectedModel === 'fal-ai-ltx-2' || selectedModel === 'ltx-2') && mode === 'retake-video') ||
    ((selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') && viduQ2Mode === 'video-extension')

  // 处理混合文件上传（视频+图片）
  const handleMixedFileUpload = (files: File[]) => {
    const videoFiles = files.filter(f => f.type.startsWith('video/'))
    const imageFiles = files.filter(f => f.type.startsWith('image/'))

    // 先处理视频（只取第一个）
    if (videoFiles.length > 0 && onVideoUpload) {
      onVideoUpload([videoFiles[0]])
    }

    // 再处理图片（如果不是只需要视频的模式）
    if (imageFiles.length > 0 && !needsVideoOnly) {
      onImageUpload(imageFiles)
    }
  }

  // 处理混合文件移除
  const handleMixedFileRemove = (index: number) => {
    // 视频在前，图片在后
    if (index < uploadedVideos.length) {
      // 移除视频
      if (onVideoRemove) {
        onVideoRemove(index)
      }
    } else {
      // 移除图片
      const imageIndex = index - uploadedVideos.length
      onImageRemove(imageIndex)
    }
  }

  // 处理混合文件替换
  const handleMixedFileReplace = (index: number, file: File) => {
    if (index < uploadedVideos.length) {
      // 替换视频
      if (onVideoReplace) {
        onVideoReplace(index, file)
      }
    } else {
      // 替换图片
      const imageIndex = index - uploadedVideos.length
      onImageReplace(imageIndex, file)
    }
  }

  // 处理混合文件点击（视频+图片）
  const handleMixedFileClick = (fileUrl: string, fileList: string[]) => {
    const index = fileList.indexOf(fileUrl)
    if (index < uploadedVideos.length) {
      // 点击视频
      if (onVideoClick) {
        onVideoClick(fileUrl)
      }
    } else {
      // 点击图片
      if (onImageClick) {
        onImageClick(fileUrl, fileList.slice(uploadedVideos.length))
      }
    }
  }

  // 合并视频和图片文件列表
  const mixedFiles = needsVideoUpload
    ? (needsVideoOnly ? uploadedVideos : [...uploadedVideos, ...uploadedImages])
    : uploadedImages

  // 计算混合上传的最大文件数
  const mixedMaxCount = needsVideoUpload
    ? (needsVideoOnly ? 1 : 1 + maxImageCount)
    : maxImageCount

  // 检查是否是 KIE Grok Imagine 视频模型且已上传1张图片（需要隐藏上传按钮）
  const shouldHideUploadButton =
    (selectedModel === 'kie-grok-imagine-video' || selectedModel === 'grok-imagine-video-kie') &&
    uploadedImages.length >= 1

  return (
    <div className="relative bg-[#131313]/70 rounded-xl border border-zinc-700/50 p-4">
      {/* 统一的文件上传区域（支持视频+图片混合上传） */}
      {currentModel?.type !== 'audio' &&
       selectedModel !== 'fal-ai-z-image-turbo' &&
       selectedModel !== 'kie-grok-imagine' &&
       selectedModel !== 'grok-imagine-kie' &&
       !isModelscopeModel &&
       // 自定义模型：只有支持图片编辑的才显示图片上传
       !(selectedModel === 'modelscope-custom' && !isModelscopeCustomWithImageEditing) && (
        <div className="mb-3">
          {needsVideoUpload && (
            <div className="text-xs text-zinc-400 mb-2">
              {needsVideoOnly
                ? '上传视频（仅支持1个视频）'
                : `上传视频和图片（视频1个 + 图片最多${maxImageCount}张）`}
            </div>
          )}
          <FileUploader
            files={mixedFiles}
            onUpload={needsVideoUpload ? handleMixedFileUpload : onImageUpload}
            onRemove={needsVideoUpload ? handleMixedFileRemove : onImageRemove}
            onReplace={needsVideoUpload ? handleMixedFileReplace : onImageReplace}
            onReorder={needsVideoUpload ? () => {} : onImageReorder}
            onImageClick={needsVideoUpload ? handleMixedFileClick : onImageClick}
            accept={needsVideoOnly ? "video/*" : (needsVideoUpload ? "video/*,image/*" : "image/*")}
            multiple={needsVideoOnly ? false : (needsVideoUpload ? true : isMultiple)}
            maxCount={mixedMaxCount}
            hideUploadButton={shouldHideUploadButton}
            {...{ onDragStateChange } as any}
          />
        </div>
      )}

      {/* 文本输入框 */}
      <div className="relative">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={onPaste}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'))
            if (files.length > 0) {
              onImageDrop(files)
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.ctrlKey) {
                // Ctrl+Enter 换行
                return
              } else {
                // Enter 生成
                e.preventDefault()
                onGenerate()
              }
            }
          }}
          placeholder={
            currentModel?.type === 'audio'
              ? '输入要合成的文本'
              : (selectedModel === 'kie-grok-imagine-video' || selectedModel === 'grok-imagine-video-kie' || selectedModel === 'black-forest-labs/FLUX.1-Krea-dev')
                ? '描述想要生成的内容（仅支持英文提示词）'
                : '描述想要生成的内容'
          }
          className={`w-full bg-transparent backdrop-blur-lg rounded-xl p-4 pr-14 ${
            // 音频模型或没有图片上传组件的模型：使用较大高度
            currentModel?.type === 'audio' || selectedModel === 'fal-ai-z-image-turbo' || selectedModel === 'kie-grok-imagine' || selectedModel === 'grok-imagine-kie' || isModelscopeModel || (selectedModel === 'modelscope-custom' && !isModelscopeCustomWithImageEditing)
              ? 'min-h-[176px]'
              : 'min-h-[100px]'
          } resize-none focus:outline-none focus:ring-2 focus:ring-white/20 transition-shadow duration-300 ease-in-out text-white placeholder-zinc-400`}
          disabled={isLoading}
        />

        {/* 生成按钮 */}
        <button
          onClick={onGenerate}
          disabled={isGenerateDisabled()}
          title={isGenerating ? '加入队列' : '开始生成'}
          className={`absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
            isGenerateDisabled()
              ? 'bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
              : isGenerating
                ? 'bg-[#007eff] hover:brightness-110 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                : 'bg-[#007eff] hover:brightness-110 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
          }`}
        >
          {isLoading ? (
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : isGenerating ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          )}
        </button>
      </div>

    </div>
  )
}

export default InputArea
