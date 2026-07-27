/**
 * FilePreview 组件
 *
 * 文件预览组件，支持图片和视频预览
 */

import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiIconButton } from '@/components/ui'
import { Pencil, Trash2 } from 'lucide-react'

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
          <UiIconButton
            className="preview-btn preview-btn-edit"
            onClick={onEdit}
            title={t('common:edit')}
          >
            <Pencil className="h-4 w-4" />
          </UiIconButton>
        )}
        <UiIconButton
          className="preview-btn preview-btn-delete"
          onClick={onDelete}
          title={t('common:delete')}
        >
          <Trash2 className="h-4 w-4" />
        </UiIconButton>
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
