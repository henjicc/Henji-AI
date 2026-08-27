import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { isBuiltinModelType } from '@/core/modelSortOrder'
import type { BuiltinModelType, ModelType } from '@/core/types'

export type ModelMediaType = ModelType

const TYPE_BADGE_COLOR_CLASS: Record<BuiltinModelType, string> = {
  image: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  video: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  audio: 'bg-green-500/20 text-green-400 border-green-500/30',
}

interface ModelTypeBadgeProps {
  type: ModelMediaType
  className?: string
}

/** 模型管理相关分区共用的类型徽标（图片/视频/音频），避免显示与管理、别名两个分区各自复制一份配色表。 */
const ModelTypeBadge: React.FC<ModelTypeBadgeProps> = ({ type, className = '' }) => {
  const { t } = useI18n('settings')
  const colorClass = isBuiltinModelType(type)
    ? TYPE_BADGE_COLOR_CLASS[type]
    : 'border-border-dark bg-layer text-text-soft'
  const label = isBuiltinModelType(type)
    ? t(`modelSettings.types.${type}`)
    : `${t('modelSettings.types.other')} · ${type}`
  return (
    <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${colorClass} ${className}`}>
      {label}
    </span>
  )
}

export default ModelTypeBadge
