/**
 * 图像查看器组件
 * 职责：显示图像并提供查看功能
 */

import React from 'react'
import { useI18n } from '@/hooks/useI18n'

interface ImageViewerProps {
  imageUrl: string
  alt?: string
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
  hasPrevious?: boolean
  hasNext?: boolean
  onDownload?: () => void
  onEdit?: () => void
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  imageUrl,
  alt,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  onDownload,
  onEdit
}) => {
  const { t } = useI18n()
  const altText = alt || t('ui:viewer.imageAlt')
  return (
    <div className="image-viewer-overlay" onClick={onClose}>
      <div className="image-viewer-container" onClick={(e) => e.stopPropagation()}>
        <div className="image-viewer-header">
          <div className="viewer-actions">
            {onDownload && (
              <button className="viewer-btn" onClick={onDownload} title={t('common:actions.download')}>
                ⬇️
              </button>
            )}
            {onEdit && (
              <button className="viewer-btn" onClick={onEdit} title={t('common:edit')}>
                ✏️
              </button>
            )}
          </div>
          <button className="viewer-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="image-viewer-content">
          {onPrevious && hasPrevious && (
            <button className="viewer-nav prev" onClick={onPrevious}>
              ‹
            </button>
          )}

          <img
            src={imageUrl}
            alt={altText}
            className="viewer-image"
          />

          {onNext && hasNext && (
            <button className="viewer-nav next" onClick={onNext}>
              ›
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
