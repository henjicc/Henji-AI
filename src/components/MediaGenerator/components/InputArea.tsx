import React, { useState, useEffect } from 'react'
import FileUploader from '@/components/ui/FileUploader'
import AlertDialog from '@/components/ui/AlertDialog'
import { getMaxImageCount } from '../utils/constants'
import { logError } from '../../../utils/errorLogger'

/**
 * 文件顺序项：记录每个位置是视频还是图片，以及在原数组中的索引
 */
export interface FileOrderItem {
  type: 'video' | 'image'
  index: number
}

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
  ppioKlingO1Mode?: string  // PPIO Kling O1 模式

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

  // 混合文件顺序（用于支持视频+图片混合排序）
  fileOrder?: FileOrderItem[]
  onFileOrderChange?: (order: FileOrderItem[]) => void

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
  ppioKlingO1Mode,
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
  fileOrder,
  onFileOrderChange,
  onGenerate
}) => {
  // 本地文件顺序状态（如果父组件没有提供）
  const [localFileOrder, setLocalFileOrder] = useState<FileOrderItem[]>([])

  // 使用父组件提供的 fileOrder 或本地状态
  const currentFileOrder = fileOrder || localFileOrder
  const setCurrentFileOrder = onFileOrderChange || setLocalFileOrder

  // 提示弹窗状态
  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    type: 'info' | 'warning' | 'error'
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'warning'
  })

  // 显示提示弹窗
  const showAlert = (title: string, message: string, type: 'info' | 'warning' | 'error' = 'warning') => {
    setAlertDialog({ isOpen: true, title, message, type })
  }

  // 当 uploadedVideos 或 uploadedImages 变化时，重建文件顺序
  useEffect(() => {
    // 只在混合上传模式下才需要维护顺序
    const needsVideoUpload =
      ((selectedModel === 'fal-ai-kling-video-o1' || selectedModel === 'kling-video-o1') &&
       (klingMode === 'video-to-video-edit' || klingMode === 'video-to-video-reference')) ||
      (selectedModel === 'kling-o1' &&
       (ppioKlingO1Mode === 'reference-to-video' || ppioKlingO1Mode === 'video-edit')) ||
      ((selectedModel === 'fal-ai-ltx-2' || selectedModel === 'ltx-2') &&
       mode === 'retake-video') ||
      ((selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') &&
       viduQ2Mode === 'video-extension')

    if (!needsVideoUpload) {
      // 非混合模式，清空顺序
      setCurrentFileOrder([])
      return
    }

    // 构建新的文件顺序
    const newOrder: FileOrderItem[] = []

    // 检查现有顺序中的文件是否还存在
    const existingVideoIndices = new Set<number>()
    const existingImageIndices = new Set<number>()

    currentFileOrder.forEach(item => {
      if (item.type === 'video' && item.index < uploadedVideos.length) {
        newOrder.push(item)
        existingVideoIndices.add(item.index)
      } else if (item.type === 'image' && item.index < uploadedImages.length) {
        newOrder.push(item)
        existingImageIndices.add(item.index)
      }
    })

    // 添加新上传的视频（不在现有顺序中的）
    for (let i = 0; i < uploadedVideos.length; i++) {
      if (!existingVideoIndices.has(i)) {
        newOrder.push({ type: 'video', index: i })
      }
    }

    // 添加新上传的图片（不在现有顺序中的）
    for (let i = 0; i < uploadedImages.length; i++) {
      if (!existingImageIndices.has(i)) {
        newOrder.push({ type: 'image', index: i })
      }
    }

    setCurrentFileOrder(newOrder)
  }, [uploadedVideos.length, uploadedImages.length, selectedModel, klingMode, ppioKlingO1Mode, mode, viduQ2Mode])
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
  // 2. PPIO Kling O1 的参考生视频和视频编辑模式（支持视频+图片）
  // 3. LTX-2 的视频编辑模式（仅支持视频）
  // 4. Vidu Q2 的视频延长模式（仅支持视频）
  const needsVideoUpload =
    ((selectedModel === 'fal-ai-kling-video-o1' || selectedModel === 'kling-video-o1') &&
     (klingMode === 'video-to-video-edit' || klingMode === 'video-to-video-reference')) ||
    (selectedModel === 'kling-o1' &&
     (ppioKlingO1Mode === 'reference-to-video' || ppioKlingO1Mode === 'video-edit')) ||
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

    // 检查当前已上传的文件数量
    const currentVideoCount = uploadedVideos.length
    const currentImageCount = uploadedImages.length

    // 处理视频：只有在没有视频时才能上传
    if (videoFiles.length > 0 && onVideoUpload && currentVideoCount === 0) {
      onVideoUpload([videoFiles[0]])
    } else if (videoFiles.length > 0 && currentVideoCount > 0) {
      // 已有视频，提示用户
      showAlert('视频数量限制', '最多只能上传1个视频，请先删除现有视频', 'warning')
    }

    // 处理图片：检查是否还有空位
    if (imageFiles.length > 0 && !needsVideoOnly) {
      const availableImageSlots = maxImageCount - currentImageCount
      if (availableImageSlots > 0) {
        onImageUpload(imageFiles)
      } else {
        showAlert('图片数量限制', `最多只能上传${maxImageCount}张图片`, 'warning')
      }
    }
  }

  // 处理混合文件移除
  const handleMixedFileRemove = (index: number) => {
    if (!needsVideoUpload || currentFileOrder.length === 0) {
      // 非混合模式，直接移除图片
      onImageRemove(index)
      return
    }

    // 混合模式：根据 fileOrder 确定要移除的文件
    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoRemove) {
      onVideoRemove(item.index)
    } else if (item.type === 'image') {
      onImageRemove(item.index)
    }

    // 移除后，fileOrder 会在 useEffect 中自动更新
  }

  // 处理混合文件替换
  const handleMixedFileReplace = (index: number, file: File) => {
    if (!needsVideoUpload || currentFileOrder.length === 0) {
      // 非混合模式，直接替换图片
      onImageReplace(index, file)
      return
    }

    // 混合模式：根据 fileOrder 确定要替换的文件
    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoReplace) {
      onVideoReplace(item.index, file)
    } else if (item.type === 'image') {
      onImageReplace(item.index, file)
    }
  }

  // 处理混合文件排序
  const handleMixedFileReorder = (from: number, to: number) => {
    if (!needsVideoUpload || currentFileOrder.length === 0) {
      // 非混合模式，使用原有的图片排序
      onImageReorder(from, to)
      return
    }

    // 混合模式：更新 fileOrder
    if (from === to) return
    const newOrder = [...currentFileOrder]
    const [item] = newOrder.splice(from, 1)
    newOrder.splice(to, 0, item)
    setCurrentFileOrder(newOrder)
  }

  // 处理混合文件点击（视频+图片）
  const handleMixedFileClick = (fileUrl: string, fileList: string[]) => {
    const index = fileList.indexOf(fileUrl)
    if (index === -1) return

    if (!needsVideoUpload || currentFileOrder.length === 0) {
      // 非混合模式，直接点击图片
      if (onImageClick) {
        onImageClick(fileUrl, fileList)
      }
      return
    }

    // 混合模式：根据 fileOrder 确定点击的文件类型
    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoClick) {
      onVideoClick(fileUrl)
    } else if (item.type === 'image' && onImageClick) {
      // 提取所有图片用于查看器
      const allImages = currentFileOrder
        .filter(f => f.type === 'image')
        .map(f => uploadedImages[f.index])
      onImageClick(fileUrl, allImages)
    }
  }

  // 合并视频和图片文件列表（根据 fileOrder 排序）
  const mixedFiles = needsVideoUpload && currentFileOrder.length > 0
    ? currentFileOrder.map(item =>
        item.type === 'video' ? uploadedVideos[item.index] : uploadedImages[item.index]
      )
    : needsVideoUpload
      ? (needsVideoOnly ? uploadedVideos : [...uploadedVideos, ...uploadedImages])
      : uploadedImages

  // 计算混合上传的最大文件数
  const mixedMaxCount = needsVideoUpload
    ? (needsVideoOnly ? 1 : 1 + maxImageCount)
    : maxImageCount

  // 检查是否应该隐藏上传按钮
  const shouldHideUploadButton = (() => {
    // KIE Grok Imagine 视频模型：已上传1张图片时隐藏
    if ((selectedModel === 'kie-grok-imagine-video' || selectedModel === 'grok-imagine-video-kie') &&
        uploadedImages.length >= 1) {
      return true
    }

    // 混合上传模式：检查是否达到上限
    if (needsVideoUpload && !needsVideoOnly) {
      const currentVideoCount = uploadedVideos.length
      const currentImageCount = uploadedImages.length

      // 视频和图片都达到上限时隐藏
      if (currentVideoCount >= 1 && currentImageCount >= maxImageCount) {
        return true
      }
    }

    // 纯视频模式：已有1个视频时隐藏
    if (needsVideoOnly && uploadedVideos.length >= 1) {
      return true
    }

    // 纯图片模式：图片达到上限时隐藏
    if (!needsVideoUpload && uploadedImages.length >= maxImageCount) {
      return true
    }

    return false
  })()

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
            onReorder={needsVideoUpload ? handleMixedFileReorder : onImageReorder}
            onImageClick={needsVideoUpload ? handleMixedFileClick : onImageClick}
            accept={needsVideoOnly ? "video/*" : (needsVideoUpload ? "video/*,image/*" : "image/*")}
            multiple={needsVideoOnly ? false : (needsVideoUpload ? true : isMultiple)}
            maxCount={mixedMaxCount}
            hideUploadButton={shouldHideUploadButton}
            fileTypes={needsVideoUpload && currentFileOrder.length > 0
              ? currentFileOrder.map(item => item.type)
              : undefined}
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

      {/* Alert Dialog */}
      <AlertDialog
        isOpen={alertDialog.isOpen}
        title={alertDialog.title}
        message={alertDialog.message}
        type={alertDialog.type}
        onClose={() => setAlertDialog({ ...alertDialog, isOpen: false })}
      />
    </div>
  )
}

export default InputArea
