import { useState, useCallback } from 'react'
import { saveUploadImage } from '@/utils/save'
import { generateVideoThumbnail, validateVideo } from '@/utils/videoProcessing'
import { extractImagesFromClipboard } from '@/utils/imageConversion'
import { logError, logInfo } from '../../../utils/errorLogger'

/**
 * 统一的文件类型定义
 */
export interface UploadedFile {
  id: string  // 唯一标识
  type: 'image' | 'video'
  thumbnail: string  // 缩略图 URL（图片直接用原图，视频用生成的缩略图）
  file?: File  // 原始文件对象（视频必须保留，图片可选）
  filePath?: string  // 已保存的文件路径（用于避免重复保存）
}

/**
 * 混合文件上传 Hook
 * 支持图片和视频混合上传、排序
 */
export const useMixedFileUpload = (onError?: (title: string, message: string) => void) => {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  /**
   * 生成唯一 ID
   */
  const generateId = () => `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  /**
   * 处理图片上传
   */
  const handleImageUpload = useCallback(async (files: File[], maxCount: number) => {
    setIsProcessing(true)
    try {
      const newFiles: UploadedFile[] = []

      for (const file of files) {
        if (uploadedFiles.length + newFiles.length >= maxCount) break

        const saved = await saveUploadImage(file, 'memory')
        newFiles.push({
          id: generateId(),
          type: 'image',
          thumbnail: saved.dataUrl,
          file
        })
      }

      setUploadedFiles(prev => [...prev, ...newFiles])
    } catch (error) {
      logError('[useMixedFileUpload] 图片上传失败:', error)
    } finally {
      setIsProcessing(false)
    }
  }, [uploadedFiles.length])

  /**
   * 处理视频上传
   */
  const handleVideoUpload = useCallback(async (files: File[], maxCount: number) => {
    if (files.length === 0) return

    setIsProcessing(true)
    try {
      const videoFile = files[0]
      logInfo('[useMixedFileUpload] 开始处理视频:', {
        data: [videoFile.name, '大小:', (videoFile.size / 1024 / 1024).toFixed(2), 'MB']
      })

      // 1. 验证视频
      const videoElement = document.createElement('video')
      videoElement.preload = 'metadata'

      await new Promise((resolve, reject) => {
        videoElement.onloadedmetadata = resolve
        videoElement.onerror = reject
        videoElement.src = URL.createObjectURL(videoFile)
      })

      const metadata = {
        duration: videoElement.duration,
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
        aspectRatio: videoElement.videoWidth / videoElement.videoHeight,
        fileSize: videoFile.size
      }

      logInfo('[useMixedFileUpload] 视频元数据:', metadata)

      const validation = validateVideo(metadata)
      if (!validation.valid) {
        if (onError) {
          onError('视频验证失败', validation.errors.join(', '))
        }
        URL.revokeObjectURL(videoElement.src)
        setIsProcessing(false)
        return
      }

      // 【关键修复】立即释放用于验证的 blob URL，避免 WebKit 后续访问已释放的 URL
      // 注意：generateVideoThumbnail 会创建自己的 blob URL
      URL.revokeObjectURL(videoElement.src)

      // 2. 生成缩略图
      logInfo('', '[useMixedFileUpload] 生成缩略图...')
      const thumbnail = await generateVideoThumbnail(videoFile)
      logInfo('', '[useMixedFileUpload] 缩略图生成成功')

      // 3. 添加到文件列表
      const videoCount = uploadedFiles.filter(f => f.type === 'video').length
      if (videoCount >= maxCount) {
        if (onError) {
          onError('视频数量限制', `最多只能上传 ${maxCount} 个视频`)
        }
        setIsProcessing(false)
        return
      }

      setUploadedFiles(prev => [...prev, {
        id: generateId(),
        type: 'video',
        thumbnail,
        file: videoFile
      }])

      logInfo('', '[useMixedFileUpload] 视频上传完成')
    } catch (error) {
      logError('[useMixedFileUpload] 视频处理失败:', error)
      if (onError) {
        onError('视频处理失败', '请确保视频格式正确')
      }
    } finally {
      setIsProcessing(false)
    }
  }, [uploadedFiles])

  /**
   * 处理混合文件上传（自动识别类型）
   */
  const handleMixedUpload = useCallback(async (files: File[], maxImageCount: number, maxVideoCount: number) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'))
    const videoFiles = files.filter(f => f.type.startsWith('video/'))

    // 先处理视频（只取第一个）
    if (videoFiles.length > 0) {
      await handleVideoUpload([videoFiles[0]], maxVideoCount)
    }

    // 再处理图片
    if (imageFiles.length > 0) {
      await handleImageUpload(imageFiles, maxImageCount + maxVideoCount)
    }
  }, [handleImageUpload, handleVideoUpload])

  /**
   * 移除文件
   */
  const removeFile = useCallback((index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  /**
   * 替换文件
   */
  const replaceFile = useCallback(async (index: number, newFile: File) => {
    const oldFile = uploadedFiles[index]
    if (!oldFile) return

    setIsProcessing(true)
    try {
      if (newFile.type.startsWith('image/')) {
        const saved = await saveUploadImage(newFile, 'memory')
        setUploadedFiles(prev => {
          const updated = [...prev]
          updated[index] = {
            id: generateId(),
            type: 'image',
            thumbnail: saved.dataUrl,
            file: newFile
          }
          return updated
        })
      } else if (newFile.type.startsWith('video/')) {
        // 验证视频
        const videoElement = document.createElement('video')
        videoElement.preload = 'metadata'

        await new Promise((resolve, reject) => {
          videoElement.onloadedmetadata = resolve
          videoElement.onerror = reject
          videoElement.src = URL.createObjectURL(newFile)
        })

        const metadata = {
          duration: videoElement.duration,
          width: videoElement.videoWidth,
          height: videoElement.videoHeight,
          aspectRatio: videoElement.videoWidth / videoElement.videoHeight,
          fileSize: newFile.size
        }

        const validation = validateVideo(metadata)
        if (!validation.valid) {
          if (onError) {
            onError('视频验证失败', validation.errors.join(', '))
          }
          URL.revokeObjectURL(videoElement.src)
          setIsProcessing(false)
          return
        }

        // 【关键修复】立即释放用于验证的 blob URL
        URL.revokeObjectURL(videoElement.src)

        const thumbnail = await generateVideoThumbnail(newFile)

        setUploadedFiles(prev => {
          const updated = [...prev]
          updated[index] = {
            id: generateId(),
            type: 'video',
            thumbnail,
            file: newFile
          }
          return updated
        })
      }
    } catch (error) {
      logError('[useMixedFileUpload] 替换文件失败:', error)
    } finally {
      setIsProcessing(false)
    }
  }, [uploadedFiles])

  /**
   * 重排序文件
   */
  const reorderFiles = useCallback((from: number, to: number) => {
    if (from === to) return
    setUploadedFiles(prev => {
      const arr = [...prev]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return arr
    })
  }, [])

  /**
   * 粘贴图片
   */
  const handlePaste = useCallback(async (e: React.ClipboardEvent, maxCount: number) => {
    try {
      const pastedFiles = await extractImagesFromClipboard(e.nativeEvent)
      if (pastedFiles.length === 0) return

      if (uploadedFiles.length >= maxCount) return

      const availableSlots = maxCount - uploadedFiles.length
      const filesToAdd = pastedFiles.slice(0, availableSlots)

      await handleImageUpload(filesToAdd, maxCount)
    } catch (error) {
      logError('[useMixedFileUpload] 粘贴图片失败', error)
    }
  }, [uploadedFiles.length, handleImageUpload])

  /**
   * 拖拽文件
   */
  const handleFileDrop = useCallback(async (files: File[], maxImageCount: number, maxVideoCount: number) => {
    await handleMixedUpload(files, maxImageCount, maxVideoCount)
  }, [handleMixedUpload])

  /**
   * 清空所有文件
   */
  const clearFiles = useCallback(() => {
    setUploadedFiles([])
  }, [])

  /**
   * 获取分类后的文件
   */
  const getFilesByType = useCallback((type: 'image' | 'video') => {
    return uploadedFiles.filter(f => f.type === type)
  }, [uploadedFiles])

  return {
    uploadedFiles,
    setUploadedFiles,
    isDraggingFile,
    setIsDraggingFile,
    isProcessing,
    handleImageUpload,
    handleVideoUpload,
    handleMixedUpload,
    removeFile,
    replaceFile,
    reorderFiles,
    handlePaste,
    handleFileDrop,
    clearFiles,
    getFilesByType
  }
}
