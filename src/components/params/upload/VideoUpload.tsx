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
import { useNotification } from '@/contexts/NotificationContext'
import { importLocalMedia } from '@/services/localMediaImport'

interface VideoUploadProps {
  param: VideoUploadParamDef
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

export const VideoUpload: React.FC<VideoUploadProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { i18n, t } = useTranslation('ui')
  const { showNotification } = useNotification()

  // 获取显示名称
  const displayName = getI18nText(param.name, i18n.language)

  // 处理上传
  const handleUpload = async (file: File) => {
    const maxCount = param.maxCount || 1
    if (value.length >= maxCount) {
      showNotification(t('uploadArea.maxVideos', { max: maxCount }), 'error')
      return
    }

    // 读取视频元数据
    const imported = await importLocalMedia(file, 'video')
    if (imported.kind !== 'video') return

    // 验证时长限制
    if (param.maxDuration && imported.durationSeconds > param.maxDuration) {
      showNotification(t('uploadArea.maxDuration', { maxDuration: param.maxDuration }), 'error')
      return
    }

    onChange([...value, imported.fullPath])
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
