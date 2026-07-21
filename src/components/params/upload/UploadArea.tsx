import { createLogger } from '@/core/logging'

const logger = createLogger('components.params.upload.UploadArea')
/**
 * UploadArea 组件
 *
 * 通用上传区域，支持拖拽和点击上传
 */

import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UiInput } from '@/components/ui'
import { useNotification } from '@/contexts/NotificationContext'

interface UploadAreaProps {
  accept: string[]
  maxSize?: number
  onUpload: (file: File) => Promise<void>
  disabled?: boolean
}

export const UploadArea: React.FC<UploadAreaProps> = ({
  accept,
  maxSize = 10,
  onUpload,
  disabled = false
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const { t } = useTranslation('ui')
  // 上传校验是即时操作反馈、且没有可跳转的补救动作，用轻量 toast 不打断操作流
  const { showNotification } = useNotification()

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    if (disabled || uploading) return

    const file = e.dataTransfer.files[0]
    if (file) {
      await processFile(file)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await processFile(file)
    }
    // 清空 input，允许重复上传同一文件
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  const processFile = async (file: File) => {
    // 验证文件类型
    if (!accept.includes(file.type)) {
      showNotification(t('uploadArea.unsupportedType', { type: file.type }), 'error')
      return
    }

    // 验证文件大小
    if (maxSize && file.size > maxSize * 1024 * 1024) {
      showNotification(t('uploadArea.tooLarge', { maxSize }), 'error')
      return
    }

    setUploading(true)
    try {
      await onUpload(file)
    } catch (error) {
      logger.error('Upload failed:', error)
      showNotification(t('uploadArea.uploadFailed'), 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className={`upload-area ${isDragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''} ${disabled ? 'disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled && !uploading) {
          setIsDragging(true)
        }
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && !uploading && inputRef.current?.click()}
    >
      <UiInput
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {uploading ? (
        <div className="upload-progress">
          <div className="upload-spinner"></div>
          <span>{t('uploadArea.uploading')}</span>
        </div>
      ) : (
        <div className="upload-hint">
          <svg className="upload-icon" viewBox="0 0 24 24" width="48" height="48">
            <path fill="currentColor" d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
          </svg>
          <span className="upload-text">{t('uploadArea.hint')}</span>
          <span className="upload-limit">
            {t('uploadArea.limit', {
              types: accept.map(t => t.split('/')[1].toUpperCase()).join(', '),
              maxSize
            })}
          </span>
        </div>
      )}
    </div>
  )
}

