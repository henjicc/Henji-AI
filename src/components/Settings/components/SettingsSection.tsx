import React from 'react'
import { UI_SECTION_STACK_CLASS } from '@/components/ui'
import { SETTINGS_SECTION_ATTR } from '../hooks/useSettingsScrollSpy'

interface SettingsSectionProps {
  /** 与左侧目录的分节 id 一致，滚动定位和高亮都靠它 */
  id: string
  children: React.ReactNode
}

/**
 * 设置弹窗里的一个分节锚点。
 *
 * 各大类现在是**一整页可滚动内容**，不再按分节切换渲染——分节内容太少的分区
 * （基础设置只有两个字段）曾经独占一整屏，剩下大片空白。改成连排后，
 * 左侧目录只负责定位，不再决定渲染什么。
 */
const SettingsSection: React.FC<SettingsSectionProps> = ({ id, children }) => (
  <section id={id} {...{ [SETTINGS_SECTION_ATTR]: id }} className={UI_SECTION_STACK_CLASS}>
    {children}
  </section>
)

export default SettingsSection
