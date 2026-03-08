/**
 * 模型标签组件
 * 职责：显示和管理模型标签
 */

import React from 'react'
import { UiChipButton } from '@/components/ui'

interface ModelTag {
  id: string
  label: string
  color?: string
}

interface ModelTagsProps {
  tags: ModelTag[]
  selectedTags: string[]
  onTagClick: (tagId: string) => void
  onTagRemove?: (tagId: string) => void
  readonly?: boolean
}

export const ModelTags: React.FC<ModelTagsProps> = ({
  tags,
  selectedTags,
  onTagClick,
  onTagRemove,
  readonly = false
}) => {
  const isSelected = (tagId: string) => selectedTags.includes(tagId)

  return (
    <div className="model-tags">
      {tags.map(tag => (
        <UiChipButton
          active={isSelected(tag.id)}
          key={tag.id}
          className={`tag ${isSelected(tag.id) ? 'selected' : ''}`}
          style={{ backgroundColor: tag.color }}
          onClick={() => onTagClick(tag.id)}
          disabled={readonly}
        >
          {tag.label}
          {!readonly && onTagRemove && isSelected(tag.id) && (
            <span
              className="tag-remove"
              onClick={(e) => {
                e.stopPropagation()
                onTagRemove(tag.id)
              }}
              >
                ×
              </span>
            )}
        </UiChipButton>
      ))}
    </div>
  )
}
