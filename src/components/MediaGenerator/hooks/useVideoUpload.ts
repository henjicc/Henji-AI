import { createLogger } from '@/core/logging'
import { useState, useCallback } from 'react'
import { generateVideoThumbnail, validateVideo, VideoValidationOptions } from '@/utils/videoProcessing'

const logger = createLogger('components.MediaGenerator.hooks.useVideoUpload')

/**
 * 视频上传 Hook（优化版）
 *
 * 策略：
 * 1. 上传时：只保存 File 对象引用 + 生成缩略图（不读取视频内容到内存）
 * 2. 点击生成时：才读取视频文件内容并上传到 FAL CDN
 * 3. 体积超出 maxSizeMB 不在上传时拦截/压缩——本地 ffmpeg 压缩推迟到生成提交时
 *    统一处理（见 GenerationService.ts），让上传保持即时，压缩耗时由任务进度条覆盖
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
  setUploadedVideoFiles: (files: File[]) => void,
  setUploadedVideoFilePaths: (paths: string[]) => void,  // 新增：用于清空路径
  onError?: (title: string, message: string) => void,
  validationOptions?: VideoValidationOptions,
  setUploadedVideoDuration?: (duration: number) => void, // 新增：设置上传视频由于时长
  // 换了一个视频/移除视频时清空裁剪选区——旧选区是针对上一个视频选的，不该继续生效
  setUploadedVideoTrimStart?: (value: number | null) => void,
  setUploadedVideoTrimEnd?: (value: number | null) => void
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
      logger.info('[useVideoUpload] 开始处理视频:', { data: [videoFile.name, '大小:', (videoFile.size / 1024 / 1024).toFixed(2), 'MB'] })

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

      logger.info('[useVideoUpload] 视频元数据:', metadata)

      // 仅在显式提供约束时校验（由模型 inputLimits.videoConstraints 驱动）
      // 文件大小不在此处校验：超限会在生成提交时本地压缩，而不是拒绝上传
      if (validationOptions) {
        const validation = validateVideo(metadata, validationOptions)
        if (!validation.valid) {
          if (onError) {
            onError('视频验证失败', validation.errors.join(', '))
          }
          URL.revokeObjectURL(videoElement.src)
          setIsProcessingVideo(false)
          return
        }
      }

      // 【关键修复】立即释放用于验证的 blob URL，避免 WebKit 后续访问已释放的 URL
      // 注意：generateVideoThumbnail 会创建自己的 blob URL
      URL.revokeObjectURL(videoElement.src)

      // 2. 生成缩略图（用于预览）
      logger.info('', '[useVideoUpload] 生成缩略图...')
      const thumbnail = await generateVideoThumbnail(videoFile)
      logger.info('', '[useVideoUpload] 缩略图生成成功')

      // 3. 保存 File 对象引用、缩略图和视频 URL
      // 注意：这里不读取视频内容，只保存 File 对象和 URL
      setUploadedVideos([thumbnail]) // 缩略图用于 UI 显示
      setUploadedVideoFiles([videoFile]) // File 对象引用，点击生成时才读取
      setUploadedVideoFilePaths([]) // 【关键修复】清空旧路径，确保下次保存时生成新路径

      // 保存视频时长
      if (setUploadedVideoDuration) {
        setUploadedVideoDuration(metadata.duration)
      }

      // 新视频上传，清空上一个视频的裁剪选区
      setUploadedVideoTrimStart?.(null)
      setUploadedVideoTrimEnd?.(null)

      setIsProcessingVideo(false)

      logger.info('', '[useVideoUpload] 视频上传完成（未读取内容，节省内存）')
    } catch (error) {
      logger.error('[useVideoUpload] 视频处理失败:', error)
      if (onError) {
        onError('视频处理失败', '请确保视频格式正确')
      }
      setIsProcessingVideo(false)
    }
  }, [
    onError,
    setUploadedVideoDuration,
    setUploadedVideoFilePaths,
    setUploadedVideoFiles,
    setUploadedVideos,
    setUploadedVideoTrimStart,
    setUploadedVideoTrimEnd,
    validationOptions
  ])

  /**
   * 移除视频
   */
  const handleVideoRemove = useCallback((_index: number) => {
    setUploadedVideos([])
    setUploadedVideoFiles([])
    setUploadedVideoFilePaths([]) // 【关键修复】同时清空路径
    if (setUploadedVideoDuration) {
      setUploadedVideoDuration(0)
    }
    setUploadedVideoTrimStart?.(null)
    setUploadedVideoTrimEnd?.(null)
  }, [setUploadedVideos, setUploadedVideoFiles, setUploadedVideoFilePaths, setUploadedVideoDuration, setUploadedVideoTrimStart, setUploadedVideoTrimEnd])

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
