/**
 * FilePreview 组件
 *
 * 文件预览组件，支持图片和视频预览
 */

import React from 'react'
import { useI18n } from '@/hooks/useI18n'

interface FilePreviewProps {
  type: 'image' | 'video'
  url: string
  onDelete: () => void
  onEdit?: () => void
  metadata?: {
    width?: number
    height?: number
    size?: number
    duration?: number
  }
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  type,
  url,
  onDelete,
  onEdit,
  metadata
}) => {
  const { t } = useI18n()
  return (
    <div className="file-preview">
      <div className="preview-content">
        {type === 'image' ? (
          <img src={url} alt={t('common:actions.preview')} className="preview-image" />
        ) : (
          <video src={url} className="preview-video" controls />
        )}
      </div>

      <div className="preview-actions">
        {onEdit && (
          <button
            type="button"
            className="preview-btn preview-btn-edit"
            onClick={onEdit}
            title={t('common:edit')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
        )}
        <button
          type="button"
          className="preview-btn preview-btn-delete"
          onClick={onDelete}
          title={t('common:delete')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>

      {metadata && (
        <div className="preview-metadata">
          {metadata.width && metadata.height && (
            <span>{metadata.width} × {metadata.height}</span>
          )}
          {metadata.duration && (
            <span>{formatDuration(metadata.duration)}</span>
          )}
        </div>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
