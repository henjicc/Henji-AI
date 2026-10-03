import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { isBuiltinModelType } from '@/core/modelSortOrder'
import type { ModelType } from '@/core/types'

export type ModelMediaType = ModelType

interface ModelTypeBadgeProps {
  type: ModelMediaType
  className?: string
}

/** 模型管理相关分区共用的类型徽标（图片/视频/音频），避免显示与管理、别名两个分区各自复制一份。 */
const ModelTypeBadge: React.FC<ModelTypeBadgeProps> = ({ type, className = '' }) => {
  const { t } = useI18n('settings')
  const label = isBuiltinModelType(type)
    ? t(`modelSettings.types.${type}`)
    : `${t('modelSettings.types.other')} · ${type}`
  return (
    // 类型靠文字区分：徽标统一中性浅底，不再按类型上蓝/紫/绿（重要记录 001：颜色只表达主动作与选中）
    <span className={`shrink-0 rounded bg-raised px-2 py-0.5 text-xs text-text2 ${className}`}>
      {label}
    </span>
  )
}

export default ModelTypeBadge
