/**
 * VideoUpload 组件
 *
 * 视频上传组件，支持拖拽、预览和元数据读取
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { VideoUploadParamDef } from '@/core/types'
import { UploadArea } from './UploadArea'
import { FilePreview } from './FilePreview'
import { getI18nText } from '@/core/types/I18nText'

interface VideoUploadProps {
  param: VideoUploadParamDef
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

interface VideoMetadata {
  url: string
  duration: number
  width?: number
  height?: number
}

export const VideoUpload: React.FC<VideoUploadProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { i18n } = useTranslation()

  // 获取显示名称
  const displayName = getI18nText(param.name, i18n.language)

  // 处理上传
  const handleUpload = async (file: File) => {
    const maxCount = param.maxCount || 1
    if (value.length >= maxCount) {
      alert(`最多上传 ${maxCount} 个视频`)
      return
    }

    // 读取视频元数据
    const metadata = await loadVideoMetadata(file)

    // 验证时长限制
    if (param.maxDuration && metadata.duration > param.maxDuration) {
      alert(`视频时长超过 ${param.maxDuration} 秒`)
      return
    }

    // 创建 Object URL
    const videoUrl = URL.createObjectURL(file)

    onChange([...value, videoUrl])
  }

  // 处理删除
  const handleDelete = (index: number) => {
    const newValue = value.filter((_, i) => i !== index)
    onChange(newValue)
  }

  return (
    <div className="video-upload-wrapper">
      <label className="param-label">
        {displayName}
        {param.required && <span className="required-mark">*</span>}
      </label>

      <div className="upload-container">
        {value.map((url, index) => (
          <FilePreview
            key={index}
            type="video"
            url={url}
            onDelete={() => handleDelete(index)}
          />
        ))}

        {value.length < (param.maxCount || 1) && (
          <UploadArea
            accept={['video/mp4', 'video/webm', 'video/quicktime']}
            maxSize={100}
            onUpload={handleUpload}
            disabled={disabled}
          />
        )}
      </div>

      {param.description && (
        <div className="param-description">{getI18nText(param.description, i18n.language)}</div>
      )}
    </div>
  )
}

// 辅助函数：加载视频并获取元数据
function loadVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src)
      resolve({
        url: URL.createObjectURL(file),
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight
      })
    }

    video.onerror = reject
    video.src = URL.createObjectURL(file)
  })
}
