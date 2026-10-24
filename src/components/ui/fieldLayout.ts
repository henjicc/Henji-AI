import { createContext, useContext } from 'react'
import type { MenuItem } from '@/hooks/useContextMenu'

/**
 * 字段排布：
 * - `form`（默认）：标签在控件上方，字段触发器是 raised 字段表面——弹窗、设置、浮层面板里的表单；
 * - `toolbar`：工具条内的紧凑排布——标签在控件左侧（辅助文字档）、下拉与面板触发器改静默按钮皮肤，
 *   用于生成输入区底栏这类“一行参数条”（界面重设计 3.2，设计稿 Generation）；
 * - `property`：属性面板（剪辑效果控件、全能调色）——每行四列：展开箭头 / 秒表 / 名称 / 数值列，数值右对齐到同一列，
 *   数值是紧凑读数框、布尔是右对齐的勾选框（重要记录 019）。`UiFormRow` 自动按这个排布。
 *
 * 由宿主在容器上提供，`Dropdown` / `PanelTrigger` / 参数标签读取；
 * 两者打开的浮层内容一律重置为 `form`，浮层里的字段不会继承工具条排布。
 */
export type UiFieldLayout = 'form' | 'toolbar' | 'property'

export const UiFieldLayoutContext = createContext<UiFieldLayout>('form')

export function useUiFieldLayout(): UiFieldLayout {
  return useContext(UiFieldLayoutContext)
}

/**
 * 属性面板排布里一行的右键菜单（重要记录 019）：属性面板没有行尾重置列，“重置”等低频动作放在名称上的右键菜单。
 * 宿主（效果控件）提供一个面板级菜单；没有宿主时调用方退回行尾按钮。
 */
export type UiPropertyMenu = (event: React.MouseEvent, items: MenuItem[]) => void
export const UiPropertyMenuContext = createContext<UiPropertyMenu | null>(null)

export function useUiPropertyMenu(): UiPropertyMenu | null {
  return useContext(UiPropertyMenuContext)
}
