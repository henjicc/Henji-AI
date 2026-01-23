import { useState, useEffect, useCallback } from 'react'

/**
 * 文件顺序项：记录每个位置是视频还是图片，以及在原数组中的索引
 */
export interface FileOrderItem {
  type: 'video' | 'image'
  index: number
}

interface UseMixedFileUploadProps {
  uploadedImages: string[]
  uploadedVideos: string[]
  selectedModel: string
  maxImageCount: number

  // 模式参数
  klingMode?: string
  ppioKlingO1Mode?: string
  ppioKling26Mode?: string
  kieKlingV26Mode?: string
  falKlingV26ProMode?: string
  mode?: string
  viduQ2Mode?: string
  ppioWan26Mode?: string

  // 回调函数
  onImageUpload: (files: File[]) => void
  onVideoUpload?: (files: File[]) => void
  onImageRemove: (index: number) => void
  onVideoRemove?: (index: number) => void
  onImageReplace: (index: number, file: File) => void
  onVideoReplace?: (index: number, file: File) => void
  onImageReorder: (from: number, to: number) => void

  // 外部文件顺序（可选）
  fileOrder?: FileOrderItem[]
  onFileOrderChange?: (order: FileOrderItem[]) => void

  // 提示回调
  onAlert?: (title: string, message: string, type: 'info' | 'warning' | 'error') => void
}

/**
 * 混合文件上传 Hook
 * 处理视频和图片的混合上传、排序和验证
 */
export const useMixedFileUpload = ({
  uploadedImages,
  uploadedVideos,
  selectedModel,
  maxImageCount,
  klingMode,
  ppioKlingO1Mode,
  ppioKling26Mode,
  kieKlingV26Mode,
  falKlingV26ProMode,
  mode,
  viduQ2Mode,
  ppioWan26Mode,
  onImageUpload,
  onVideoUpload,
  onImageRemove,
  onVideoRemove,
  onImageReplace,
  onVideoReplace,
  onImageReorder,
  fileOrder,
  onFileOrderChange,
  onAlert
}: UseMixedFileUploadProps) => {
  // 本地文件顺序状态（如果父组件没有提供）
  const [localFileOrder, setLocalFileOrder] = useState<FileOrderItem[]>([])

  // 使用父组件提供的 fileOrder 或本地状态
  const currentFileOrder = fileOrder || localFileOrder
  const setCurrentFileOrder = onFileOrderChange || setLocalFileOrder

  // 检查是否需要视频上传
  const needsVideoUpload =
    ((selectedModel === 'fal-ai-kling-video-o1' || selectedModel === 'kling-video-o1') &&
      (klingMode === 'video-to-video-edit' || klingMode === 'video-to-video-reference')) ||
    (selectedModel === 'kling-o1' &&
      (ppioKlingO1Mode === 'reference-to-video' || ppioKlingO1Mode === 'video-edit')) ||
    ((selectedModel === 'fal-ai-ltx-2' || selectedModel === 'ltx-2') &&
      mode === 'retake-video') ||
    ((selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') &&
      viduQ2Mode === 'video-extension') ||
    (selectedModel === 'kling-2.6-pro' && ppioKling26Mode === 'motion-control') ||
    ((selectedModel === 'fal-ai-kling-video-v2.6-pro' || selectedModel === 'kling-video-v2.6-pro') && falKlingV26ProMode === 'motion-control') ||
    (selectedModel === 'kie-kling-v2-6' && kieKlingV26Mode === 'motion-control') ||
    (selectedModel === 'wan-2.6' && ppioWan26Mode === 'reference-to-video')

  // 检查是否只需要视频
  const needsVideoOnly =
    ((selectedModel === 'fal-ai-ltx-2' || selectedModel === 'ltx-2') && mode === 'retake-video') ||
    ((selectedModel === 'fal-ai-vidu-q2' || selectedModel === 'vidu-q2') && viduQ2Mode === 'video-extension')

  // 检查是否是动作控制模式
  const isMotionControlMode =
    (selectedModel === 'kling-2.6-pro' && ppioKling26Mode === 'motion-control') ||
    (selectedModel === 'kie-kling-v2-6' && kieKlingV26Mode === 'motion-control') ||
    ((selectedModel === 'fal-ai-kling-video-v2.6-pro' || selectedModel === 'kling-video-v2.6-pro') && falKlingV26ProMode === 'motion-control')

  // 当文件变化时，重建文件顺序
  useEffect(() => {
    if (!needsVideoUpload) {
      setCurrentFileOrder([])
      return
    }

    const newOrder: FileOrderItem[] = []
    const existingVideoIndices = new Set<number>()
    const existingImageIndices = new Set<number>()

    // 保留现有顺序中仍然存在的文件
    currentFileOrder.forEach(item => {
      if (item.type === 'video' && item.index < uploadedVideos.length) {
        newOrder.push(item)
        existingVideoIndices.add(item.index)
      } else if (item.type === 'image' && item.index < uploadedImages.length) {
        newOrder.push(item)
        existingImageIndices.add(item.index)
      }
    })

    // 添加新上传的视频
    for (let i = 0; i < uploadedVideos.length; i++) {
      if (!existingVideoIndices.has(i)) {
        newOrder.push({ type: 'video', index: i })
      }
    }

    // 添加新上传的图片
    for (let i = 0; i < uploadedImages.length; i++) {
      if (!existingImageIndices.has(i)) {
        newOrder.push({ type: 'image', index: i })
      }
    }

    setCurrentFileOrder(newOrder)
  }, [uploadedVideos.length, uploadedImages.length, selectedModel, klingMode, ppioKlingO1Mode, ppioKling26Mode, kieKlingV26Mode, mode, viduQ2Mode, falKlingV26ProMode, ppioWan26Mode, needsVideoUpload])

  // 获取视频时长
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

  // 处理混合文件上传
  const handleMixedFileUpload = useCallback(async (files: File[]) => {
    const videoFiles = files.filter(f => f.type.startsWith('video/'))
    const imageFiles = files.filter(f => f.type.startsWith('image/'))

    const currentVideoCount = uploadedVideos.length
    const currentImageCount = uploadedImages.length

    // 处理视频
    if (videoFiles.length > 0 && onVideoUpload && currentVideoCount === 0) {
      const file = videoFiles[0]

      // 动作控制模式：检查视频大小和时长
      if (isMotionControlMode) {
        const MAX_SIZE = 100 * 1024 * 1024 // 100MB
        if (file.size > MAX_SIZE) {
          onAlert?.('视频大小限制', '文件大小不能超过 100MB', 'warning')
          return
        }

        try {
          const duration = await getVideoDuration(file)
          if (duration < 3 || duration > 30) {
            onAlert?.('视频时长限制', `视频时长需在 3-30 秒之间（当前${duration.toFixed(1)}秒）`, 'warning')
            return
          }
        } catch (e) {
          onAlert?.('视频验证失败', '无法读取视频文件信息，请检查文件是否损坏', 'error')
          return
        }
      }

      onVideoUpload([file])
    } else if (videoFiles.length > 0 && currentVideoCount > 0) {
      onAlert?.('视频数量限制', '最多只能上传1个视频，请先删除现有视频', 'warning')
    }

    // 处理图片
    if (imageFiles.length > 0 && !needsVideoOnly) {
      if (isMotionControlMode) {
        if (currentImageCount >= 1) {
          onAlert?.('图片数量限制', '动作控制模式只能上传1张图片，请先删除现有图片', 'warning')
        } else {
          onImageUpload([imageFiles[0]])
        }
      } else {
        const availableImageSlots = maxImageCount - currentImageCount
        if (availableImageSlots > 0) {
          onImageUpload(imageFiles)
        } else {
          onAlert?.('图片数量限制', `最多只能上传${maxImageCount}张图片`, 'warning')
        }
      }
    }
  }, [uploadedVideos.length, uploadedImages.length, isMotionControlMode, needsVideoOnly, maxImageCount, onVideoUpload, onImageUpload, onAlert])

  // 处理混合文件移除
  const handleMixedFileRemove = useCallback((index: number) => {
    if (!needsVideoUpload || currentFileOrder.length === 0) {
      onImageRemove(index)
      return
    }

    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoRemove) {
      onVideoRemove(item.index)
    } else if (item.type === 'image') {
      onImageRemove(item.index)
    }
  }, [needsVideoUpload, currentFileOrder, onVideoRemove, onImageRemove])

  // 处理混合文件替换
  const handleMixedFileReplace = useCallback((index: number, file: File) => {
    if (!needsVideoUpload || currentFileOrder.length === 0) {
      onImageReplace(index, file)
      return
    }

    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoReplace) {
      onVideoReplace(item.index, file)
    } else if (item.type === 'image') {
      onImageReplace(item.index, file)
    }
  }, [needsVideoUpload, currentFileOrder, onVideoReplace, onImageReplace])

  // 处理混合文件排序
  const handleMixedFileReorder = useCallback((from: number, to: number) => {
    if (!needsVideoUpload || currentFileOrder.length === 0) {
      onImageReorder(from, to)
      return
    }

    if (from === to) return
    const newOrder = [...currentFileOrder]
    const [item] = newOrder.splice(from, 1)
    newOrder.splice(to, 0, item)
    setCurrentFileOrder(newOrder)
  }, [needsVideoUpload, currentFileOrder, onImageReorder, setCurrentFileOrder])

  // 合并文件列表
  const mixedFiles = needsVideoUpload && currentFileOrder.length > 0
    ? currentFileOrder.map(item =>
        item.type === 'video' ? uploadedVideos[item.index] : uploadedImages[item.index]
      )
    : needsVideoUpload
      ? (needsVideoOnly ? uploadedVideos : [...uploadedVideos, ...uploadedImages])
      : uploadedImages

  // 计算最大文件数
  const mixedMaxCount = needsVideoUpload
    ? (needsVideoOnly ? 1 : 1 + maxImageCount)
    : maxImageCount

  // 检查是否应该隐藏上传按钮
  const shouldHideUploadButton = (() => {
    // KIE Grok Imagine 视频模型
    if ((selectedModel === 'kie-grok-imagine-video' || selectedModel === 'grok-imagine-video-kie') &&
      uploadedImages.length >= 1) {
      return true
    }

    // KIE 可灵2.6 文/图生视频模式
    if ((selectedModel === 'kie-kling-v2-6' || selectedModel === 'kling-v2-6-kie') &&
      kieKlingV26Mode !== 'motion-control' &&
      uploadedImages.length >= 1) {
      return true
    }

    // 混合上传模式
    if (needsVideoUpload && !needsVideoOnly) {
      const currentVideoCount = uploadedVideos.length
      const currentImageCount = uploadedImages.length

      if (isMotionControlMode && currentVideoCount >= 1 && currentImageCount >= 1) {
        return true
      }

      if (!isMotionControlMode && currentVideoCount >= 1 && currentImageCount >= maxImageCount) {
        return true
      }
    }

    // 纯视频模式
    if (needsVideoOnly && uploadedVideos.length >= 1) {
      return true
    }

    // 纯图片模式
    if (!needsVideoUpload && uploadedImages.length >= maxImageCount) {
      return true
    }

    return false
  })()

  return {
    needsVideoUpload,
    needsVideoOnly,
    isMotionControlMode,
    currentFileOrder,
    mixedFiles,
    mixedMaxCount,
    shouldHideUploadButton,
    handleMixedFileUpload,
    handleMixedFileRemove,
    handleMixedFileReplace,
    handleMixedFileReorder
  }
}
