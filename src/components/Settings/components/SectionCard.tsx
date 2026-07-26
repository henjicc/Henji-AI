import React from 'react'
import { UiGroup } from '@/components/ui'

interface SectionCardProps {
  title: string
  description?: string
  titleClassName?: string
  children: React.ReactNode
}

/**
 * 设置分区容器。
 *
 * 曾经是一张卡片（`rounded-xl border border-border-dark bg-panel`），
 * 而它的父级链已经是「设置弹窗（bg-panel + border + shadow）→ 内容区（bg-app）」，
 * 于是形成"卡片里再套一张更亮的卡片"，内部字段行还会叠出第三层 bg-surface-dark。
 *
 * 现在改为零装饰分组：靠分区标题 + 间距建立层级，不再画边框背景；
 * 标题使用正式的 section 档，确保强于内部字段标签。
 * 名字保留 `SectionCard` 只是为了不动 15 个调用点；新代码请直接用 `UiGroup`。
 */
const SectionCard: React.FC<SectionCardProps> = ({ title, description, titleClassName = '', children }) => {
  return (
    <UiGroup
      title={titleClassName ? <span className={titleClassName}>{title}</span> : title}
      description={description}
    >
      {children}
    </UiGroup>
  )
}

export default SectionCard
