import { createContext, useContext } from 'react'

/**
 * 字段排布：
 * - `form`（默认）：标签在控件上方，字段触发器是 raised 字段表面——弹窗、设置、浮层面板里的表单；
 * - `toolbar`：工具条内的紧凑排布——标签在控件左侧（辅助文字档）、下拉与面板触发器改静默按钮皮肤，
 *   用于生成输入区底栏这类“一行参数条”（界面重设计 3.2，设计稿 Generation）。
 *
 * 由宿主在容器上提供，`Dropdown` / `PanelTrigger` / 参数标签读取；
 * 两者打开的浮层内容一律重置为 `form`，浮层里的字段不会继承工具条排布。
 */
export type UiFieldLayout = 'form' | 'toolbar'

export const UiFieldLayoutContext = createContext<UiFieldLayout>('form')

export function useUiFieldLayout(): UiFieldLayout {
  return useContext(UiFieldLayoutContext)
}
