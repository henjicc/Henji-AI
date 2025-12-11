import { useState, useCallback } from 'react'
import { generateVideoThumbnail, validateVideo } from '@/utils/videoProcessing'
import { logError, logInfo } from '../../../utils/errorLogger'

/**
 * 视频上传 Hook（优化版）
 *
 * 策略：
 * 1. 上传时：只保存 File 对象引用 + 生成缩略图（不读取视频内容到内存）
 * 2. 点击生成时：才读取视频文件内容并上传到 FAL CDN
 *
 * 优势：
 * - 避免大视频文件（最大200MB）占用内存
 * - 上传响应快速，只需生成缩略图
 * - 与图片处理策略一致
 */
export const useVideoUpload = (
  _uploadedVideos: string[],
  setUploadedVideos: (videos: string[]) => void,
  _uploadedVideoFiles: File[],
  setUploadedVideoFiles: (files: File[]) => void
) => {
  const [isProcessingVideo, setIsProcessingVideo] = useState(false)

  /**
   * 处理视频上传
   * 只验证视频并生成缩略图，不读取视频内容到内存
   */
  const handleVideoUpload = useCallback(async (files: File[]) => {
    if (files.length === 0) return

    setIsProcessingVideo(true)

    try {
      const videoFile = files[0] // 只处理第一个视频文件
      logInfo('[useVideoUpload] 开始处理视频:', { data: [videoFile.name, '大小:', (videoFile.size / 1024 / 1024).toFixed(2), 'MB'] })

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

      logInfo('[useVideoUpload] 视频元数据:', metadata)

      // 验证视频
      const validation = validateVideo(metadata)
      if (!validation.valid) {
        alert(`视频验证失败：${validation.errors.join(', ')}`)
        URL.revokeObjectURL(videoElement.src)
        setIsProcessingVideo(false)
        return
      }

      // 2. 生成缩略图（用于预览）
      logInfo('', '[useVideoUpload] 生成缩略图...')
      const thumbnail = await generateVideoThumbnail(videoFile)
      logInfo('', '[useVideoUpload] 缩略图生成成功')

      // 3. 保存 File 对象引用、缩略图和视频 URL
      // 注意：这里不读取视频内容，只保存 File 对象和 URL
      setUploadedVideos([thumbnail]) // 缩略图用于 UI 显示
      setUploadedVideoFiles([videoFile]) // File 对象引用，点击生成时才读取

      // 清理元数据加载时创建的临时 URL
      URL.revokeObjectURL(videoElement.src)
      setIsProcessingVideo(false)

      logInfo('', '[useVideoUpload] 视频上传完成（未读取内容，节省内存）')
    } catch (error) {
      logError('[useVideoUpload] 视频处理失败:', error)
      alert('视频处理失败，请确保视频格式正确')
      setIsProcessingVideo(false)
    }
  }, [setUploadedVideos, setUploadedVideoFiles])

  /**
   * 移除视频
   */
  const handleVideoRemove = useCallback((_index: number) => {
    setUploadedVideos([])
    setUploadedVideoFiles([])
  }, [setUploadedVideos, setUploadedVideoFiles])

  /**
   * 替换视频
   */
  const handleVideoReplace = useCallback(async (index: number, file: File) => {
    // 先移除，再上传
    handleVideoRemove(index)
    await handleVideoUpload([file])
  }, [handleVideoRemove, handleVideoUpload])

  return {
    isProcessingVideo,
    handleVideoUpload,
    handleVideoRemove,
    handleVideoReplace
  }
}
