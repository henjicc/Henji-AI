interface DropdownDisplayOption<T extends string | number | boolean> {
  label: string
  value: T
}

export function resolveDropdownDisplay<T extends string | number | boolean>(
  display: string | undefined,
  value: T | undefined,
  options: DropdownDisplayOption<T>[] | undefined,
): string {
  return display ?? options?.find((option) => option.value === value)?.label ?? String(value ?? '')
}

/** 文字菜单项（`UiOptionButton variant="menu"`）左右内边距合计，按尺寸档 sm 8+8 / md 10+10 / lg 12+12。 */
export const UI_MENU_ITEM_PADDING_X_PX = { sm: 16, md: 20, lg: 24 } as const

/** 选中勾槽：文字与勾的间距 8 + 勾 14。只有带选中态的菜单（下拉选值）才预留；动作菜单没有勾，不留（任务 5.9）。 */
export const UI_MENU_ITEM_CHECK_SLOT_PX = 22

/**
 * 带选中态的文字菜单项除文字外的横向占位 = 内边距 + 勾槽。
 * 菜单宽度必须按“菜单项自己的留白”算，不能借用触发器的留白——
 * 4.3 前借用触发器留白（静默 40 / 字段 44），带勾的选中项差 8–12px 被截成“参考生…”。
 */
export const UI_MENU_ITEM_HORIZONTAL_CHROME_PX = {
  sm: UI_MENU_ITEM_PADDING_X_PX.sm + UI_MENU_ITEM_CHECK_SLOT_PX,
  md: UI_MENU_ITEM_PADDING_X_PX.md + UI_MENU_ITEM_CHECK_SLOT_PX,
  lg: UI_MENU_ITEM_PADDING_X_PX.lg + UI_MENU_ITEM_CHECK_SLOT_PX,
} as const

/** 菜单是否有选中态：`single` 选值菜单（项上有勾）/ `none` 动作菜单（没有勾，不留勾槽）。 */
export type UiMenuSelection = 'none' | 'single'

/** 菜单项除文字外的横向占位：动作菜单只算内边距，选值菜单加勾槽。 */
export function resolveMenuItemHorizontalChrome(size: keyof typeof UI_MENU_ITEM_PADDING_X_PX, selection: UiMenuSelection): number {
  return selection === 'single' ? UI_MENU_ITEM_HORIZONTAL_CHROME_PX[size] : UI_MENU_ITEM_PADDING_X_PX[size]
}

/** 下拉浮层自身的横向占位：边框 1+1 + 列表内边距 p-1（4+4）。 */
export const DROPDOWN_PANEL_HORIZONTAL_CHROME_PX = 10

/** 按选项内容自适应的菜单宽度上限；超过才截断（截断项带 title）。 */
export const DROPDOWN_MENU_MAX_WIDTH_PX = 360

/**
 * 画布测字与实际排版的亚像素差（中文字形、缩放后取整）：实测“休闲”测得 26、排版 26.x，选中项被截成“休…”。
 * 菜单宽度统一多留这点余量。
 */
export const MENU_TEXT_ROUNDING_SLACK_PX = 2

/**
 * 菜单最小宽度 = 最长选项文字 + 菜单项留白（选值菜单含勾槽）+ 浮层留白 + 取整余量，
 * 封顶 `DROPDOWN_MENU_MAX_WIDTH_PX`。
 */
export function resolveDropdownMenuWidth(
  textWidth: number,
  size: keyof typeof UI_MENU_ITEM_PADDING_X_PX,
  selection: UiMenuSelection = 'single',
): number {
  return Math.min(
    DROPDOWN_MENU_MAX_WIDTH_PX,
    Math.ceil(textWidth + resolveMenuItemHorizontalChrome(size, selection) + DROPDOWN_PANEL_HORIZONTAL_CHROME_PX + MENU_TEXT_ROUNDING_SLACK_PX),
  )
}
