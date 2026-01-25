/**
 * UploadArea 组件
 *
 * 通用上传区域，支持拖拽和点击上传
 */

import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
      alert(t('uploadArea.unsupportedType', { type: file.type }))
      return
    }

    // 验证文件大小
    if (maxSize && file.size > maxSize * 1024 * 1024) {
      alert(t('uploadArea.tooLarge', { maxSize }))
      return
    }

    setUploading(true)
    try {
      await onUpload(file)
    } catch (error) {
      console.error('Upload failed:', error)
      alert(t('uploadArea.uploadFailed'))
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
      <input
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
