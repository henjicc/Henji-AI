import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import FileUploader from '@/components/ui/FileUploader'
import AlertDialog from '@/components/ui/AlertDialog'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { validateGenerationRequirements } from '@/core/validation/modelRequirements'
import { hasTag } from '@/core/tags'

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
  modelParams: Record<string, unknown>
  uploadedImages: string[]
  isLoading: boolean
  isGenerating?: boolean

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
  modelParams,
  uploadedImages,
  isLoading,
  isGenerating,
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
  const { t } = useTranslation('ui')

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

  const inputLimits = resolveInputLimits(
    selectedModel,
    modelParams,
    { imagesCount: uploadedImages.length, videosCount: uploadedVideos.length }
  )
  const maxImageCount = inputLimits.images.max
  const minImageCount = inputLimits.images.min
  const maxVideoCount = inputLimits.videos.max
  const minVideoCount = inputLimits.videos.min
  const videoConstraints = inputLimits.videoConstraints
  const needsVideoUpload = maxVideoCount > 0
  const needsVideoOnly = needsVideoUpload && maxImageCount === 0
  const isMultiple = maxImageCount > 1
  const shouldShowUpload = currentModel?.type !== 'audio' && (maxImageCount > 0 || needsVideoUpload)
  const isEnglishPromptOnly = hasTag(selectedModel, 'english-prompt-only')

  const formatLimitText = (min: number, max: number, unit: string) => {
    if (max <= 0) return ''
    if (min === max) return t('inputArea.limit.exact', { count: max, unit })
    if (min > 0) return t('inputArea.limit.range', { min, max, unit })
    return t('inputArea.limit.max', { max, unit })
  }

  const uploadHint = (() => {
    if (!needsVideoUpload) {
      return t('inputArea.upload.images', {
        range: formatLimitText(minImageCount, maxImageCount, t('inputArea.unit.images'))
      })
    }

    if (needsVideoOnly) {
      return t('inputArea.upload.videos', {
        range: formatLimitText(minVideoCount, maxVideoCount, t('inputArea.unit.videos'))
      })
    }

    const videoText = formatLimitText(minVideoCount, maxVideoCount, t('inputArea.unit.videos'))
    const imageText = formatLimitText(minImageCount, maxImageCount, t('inputArea.unit.images'))
    const fixedCounts = minVideoCount === maxVideoCount && minImageCount === maxImageCount
    return fixedCounts
      ? t('inputArea.upload.mixedFixed', { videoRange: videoText, imageRange: imageText })
      : t('inputArea.upload.mixed', { videoRange: videoText, imageRange: imageText })
  })()

  const isSameOrder = (a: FileOrderItem[], b: FileOrderItem[]) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i].type !== b[i].type || a[i].index !== b[i].index) return false
    }
    return true
  }

  useEffect(() => {
    if (!needsVideoUpload) {
      if (currentFileOrder.length > 0) {
        setCurrentFileOrder([])
      }
      return
    }

    const newOrder: FileOrderItem[] = []
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

    for (let i = 0; i < uploadedVideos.length; i++) {
      if (!existingVideoIndices.has(i)) {
        newOrder.push({ type: 'video', index: i })
      }
    }

    for (let i = 0; i < uploadedImages.length; i++) {
      if (!existingImageIndices.has(i)) {
        newOrder.push({ type: 'image', index: i })
      }
    }

    if (!isSameOrder(currentFileOrder, newOrder)) {
      setCurrentFileOrder(newOrder)
    }
  }, [needsVideoUpload, uploadedVideos.length, uploadedImages.length, currentFileOrder])

  const requirementCheck = validateGenerationRequirements(
    selectedModel,
    modelParams,
    {
      prompt: input,
      imagesCount: uploadedImages.length,
      videosCount: uploadedVideos.length
    }
  )

  const isGenerateDisabled = () => {
    if (isLoading) return true
    if (currentModel?.type === 'audio' && !input.trim()) return true
    if (currentModel?.type !== 'audio' && !input.trim() && uploadedImages.length === 0 && uploadedVideos.length === 0) {
      return true
    }
    return !requirementCheck.ok
  }

  // 辅助函数：获取视频时长
  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url)
        resolve(video.duration)
      }
      video.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('无法读取视频元数据'))
      }
      video.src = url
    })
  }

  // 处理混合文件上传（视频+图片）
  const handleMixedFileUpload = async (files: File[]) => {
    const videoFiles = files.filter(f => f.type.startsWith('video/'))
    const imageFiles = files.filter(f => f.type.startsWith('image/'))

    // 检查当前已上传的文件数量
    const currentVideoCount = uploadedVideos.length
    const currentImageCount = uploadedImages.length

    // 处理视频：只有在没有视频时才能上传
    if (videoFiles.length > 0 && onVideoUpload && currentVideoCount < maxVideoCount) {
      const file = videoFiles[0]

      if (videoConstraints) {
        if (videoConstraints.maxSizeMB) {
          const maxSizeBytes = videoConstraints.maxSizeMB * 1024 * 1024
          if (file.size > maxSizeBytes) {
            showAlert(
              t('inputArea.alerts.videoSize.title'),
              t('inputArea.alerts.videoSize.message', { maxSizeMB: videoConstraints.maxSizeMB }),
              'warning'
            )
            return
          }
        }

        if (videoConstraints.minDurationSec || videoConstraints.maxDurationSec) {
          try {
            const duration = await getVideoDuration(file)
            if (videoConstraints.minDurationSec && duration < videoConstraints.minDurationSec) {
              showAlert(
                t('inputArea.alerts.videoDuration.title'),
                t('inputArea.alerts.videoDuration.min', {
                  minDuration: videoConstraints.minDurationSec,
                  duration: duration.toFixed(1)
                }),
                'warning'
              )
              return
            }
            if (videoConstraints.maxDurationSec && duration > videoConstraints.maxDurationSec) {
              showAlert(
                t('inputArea.alerts.videoDuration.title'),
                t('inputArea.alerts.videoDuration.max', {
                  maxDuration: videoConstraints.maxDurationSec,
                  duration: duration.toFixed(1)
                }),
                'warning'
              )
              return
            }
          } catch (e) {
            showAlert(
              t('inputArea.alerts.videoMetadataFailed.title'),
              t('inputArea.alerts.videoMetadataFailed.message'),
              'error'
            )
            return
          }
        }
      }

      onVideoUpload([file])
    } else if (videoFiles.length > 0 && currentVideoCount >= maxVideoCount) {
      showAlert(
        t('inputArea.alerts.videoCount.title'),
        t('inputArea.alerts.videoCount.message', { max: maxVideoCount }),
        'warning'
      )
    }

    // 处理图片：检查是否还有空位
    if (imageFiles.length > 0 && !needsVideoOnly) {
      const availableImageSlots = maxImageCount - currentImageCount
      if (availableImageSlots > 0) {
        onImageUpload(imageFiles)
      } else {
        showAlert(
          t('inputArea.alerts.imageCount.title'),
          t('inputArea.alerts.imageCount.message', { max: maxImageCount }),
          'warning'
        )
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
    ? (needsVideoOnly ? maxVideoCount : maxVideoCount + maxImageCount)
    : maxImageCount

  // 检查是否应该隐藏上传按钮
  const shouldHideUploadButton = (() => {
    // 混合上传模式：检查是否达到上限
    if (needsVideoUpload && !needsVideoOnly) {
      const currentVideoCount = uploadedVideos.length
      const currentImageCount = uploadedImages.length
      return currentVideoCount >= maxVideoCount && currentImageCount >= maxImageCount
    }

    // 纯视频模式：已有1个视频时隐藏
    if (needsVideoOnly && uploadedVideos.length >= maxVideoCount) {
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
      {shouldShowUpload && (
          <div className="mb-3">
            {needsVideoUpload && (
              <div className="text-xs text-zinc-400 mb-2">
                {uploadHint}
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
              ? t('inputArea.placeholder.audio')
              : isEnglishPromptOnly
                ? t('inputArea.placeholder.englishOnly')
                : t('inputArea.placeholder.default')
          }
          className={`w-full bg-transparent backdrop-blur-lg rounded-xl p-4 pr-14 ${
            // 音频模型或没有图片上传组件的模型：使用较大高度
            currentModel?.type === 'audio' || !shouldShowUpload
              ? 'min-h-[176px]'
              : 'min-h-[100px]'
            } resize-none focus:outline-none focus:ring-2 focus:ring-white/20 transition-shadow duration-300 ease-in-out text-white placeholder-zinc-400`}
          disabled={isLoading}
        />

        {/* 生成按钮 */}
        <button
          onClick={onGenerate}
          disabled={isGenerateDisabled()}
          title={isGenerating ? t('inputArea.button.queue') : t('inputArea.button.generate')}
          className={`absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${isGenerateDisabled()
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
