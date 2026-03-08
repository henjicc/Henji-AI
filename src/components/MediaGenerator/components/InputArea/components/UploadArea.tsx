/**
 * 上传区域组件
 * 职责：处理文件上传和拖放
 */

import React from 'react'
import { UiIconButton, UiInput } from '@/components/ui'

interface UploadAreaProps {
  onFilesSelected: (files: File[]) => void
  accept?: string
  multiple?: boolean
  isDragging: boolean
  onDragEnter: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  uploadedFiles?: File[]
  onFileRemove?: (index: number) => void
}

export const UploadArea: React.FC<UploadAreaProps> = ({
  onFilesSelected,
  accept = 'image/*,video/*',
  multiple = true,
  isDragging,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  uploadedFiles = [],
  onFileRemove
}) => {
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      onFilesSelected(files)
    }
  }

  return (
    <div className="upload-area-container">
      <div
        className={`upload-area ${isDragging ? 'dragging' : ''}`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <UiInput
          type="file"
          id="file-input"
          accept={accept}
          multiple={multiple}
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
        <label htmlFor="file-input" className="upload-label">
          <div className="upload-icon">📁</div>
          <div className="upload-text">
            {isDragging ? '释放以上传文件' : '点击或拖放文件到此处'}
          </div>
          <div className="upload-hint">
            支持图片和视频文件
          </div>
        </label>
      </div>

      {uploadedFiles.length > 0 && (
        <div className="uploaded-files">
          {uploadedFiles.map((file, index) => (
            <div key={index} className="uploaded-file">
              <span className="file-name">{file.name}</span>
              <span className="file-size">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
              {onFileRemove && (
                <UiIconButton
                  className="file-remove"
                  onClick={() => onFileRemove(index)}
                >
                  ×
                </UiIconButton>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
