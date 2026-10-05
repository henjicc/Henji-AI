import React from 'react'
import { UI_FORM_ROW_GAP_CLASS } from '@/components/ui'

interface SettingsDependentRowsProps {
  /** 主开关或主选项是否让这些从属项生效 */
  open: boolean
  children: React.ReactNode
}

/**
 * 从属设置项：主开关关闭时直接收起，打开时缩进显示在主开关下面。
 *
 * 以前从属项只是 `opacity-50` 变灰，关闭时照样占着位置，也看不出谁管谁。
 * 不生效的行不渲染（而不是收到 0 高）：父级是 `space-y-*`，留一个空节点会多出一段间距。
 */
const SettingsDependentRows: React.FC<SettingsDependentRowsProps> = ({ open, children }) => (
  open ? <div className={`pl-6 ${UI_FORM_ROW_GAP_CLASS}`}>{children}</div> : null
)

export default SettingsDependentRows
