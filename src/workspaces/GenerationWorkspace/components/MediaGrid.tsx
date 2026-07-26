/**
 * 媒体网格组件
 * 职责：以网格形式显示媒体文件
 */

import React from 'react'
import { UiCheckbox, UiEmpty } from '@/components/ui'

interface MediaItem {
  id: string
  type: 'image' | 'video' | 'audio'
  url: string
  thumbnail?: string
  name?: string
  createdAt: number
}

interface MediaGridProps {
  items: MediaItem[]
  viewMode: 'grid' | 'list'
  onItemClick: (itemId: string) => void
  onItemSelect?: (itemId: string) => void
  selectedItems?: string[]
  showCheckbox?: boolean
}

export const MediaGrid: React.FC<MediaGridProps> = ({
  items,
  viewMode,
  onItemClick,
  onItemSelect,
  selectedItems = [],
  showCheckbox = false
}) => {
  const getTypeIcon = (type: MediaItem['type']) => {
    switch (type) {
      case 'image': return '🖼️'
      case 'video': return '🎬'
      case 'audio': return '🎵'
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const isSelected = (itemId: string) => selectedItems.includes(itemId)

  return (
    <div className={`media-grid ${viewMode}`}>
      {items.length === 0 ? (
        <UiEmpty size="sm" title="暂无媒体文件" />
      ) : (
        items.map(item => (
          <div
            key={item.id}
            className={`media-item ${isSelected(item.id) ? 'selected' : ''}`}
            onClick={() => onItemClick(item.id)}
          >
            {showCheckbox && onItemSelect && (
              <UiCheckbox
                className="media-checkbox"
                checked={isSelected(item.id)}
                onCheckedChange={() => {
                  onItemSelect(item.id)
                }}
                onClick={(e) => e.stopPropagation()}
              />
            )}

            <div className="media-preview">
              {item.type === 'image' || item.type === 'video' ? (
                <img
                  src={item.thumbnail || item.url}
                  alt={item.name || item.id}
                  className="media-thumbnail"
                />
              ) : (
                <div className="media-icon">
                  {getTypeIcon(item.type)}
                </div>
              )}
              {item.type === 'video' && (
                <div className="media-play-overlay">▶</div>
              )}
            </div>

            <div className="media-info">
              <div className="media-name">
                {item.name || `${item.type}-${item.id.slice(0, 8)}`}
              </div>
              <div className="media-meta">
                <span className="media-type">{getTypeIcon(item.type)}</span>
                <span className="media-date">{formatDate(item.createdAt)}</span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
