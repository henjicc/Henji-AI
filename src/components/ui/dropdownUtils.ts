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

/**
 * 文字菜单项（`UiOptionButton variant="menu"`）除文字外的横向占位，按尺寸档：
 * 左右内边距（sm 8+8 / md 10+10 / lg 12+12）+ 文字与选中勾的间距 8 + 勾 14。
 * 菜单宽度必须按“菜单项自己的留白”算，不能借用触发器的留白——
 * 4.3 前借用触发器留白（静默 40 / 字段 44），带勾的选中项差 8–12px 被截成“参考生…”。
 */
export const UI_MENU_ITEM_HORIZONTAL_CHROME_PX = { sm: 38, md: 42, lg: 46 } as const

/** 下拉浮层自身的横向占位：边框 1+1 + 列表内边距 p-1（4+4）。 */
export const DROPDOWN_PANEL_HORIZONTAL_CHROME_PX = 10

/** 按选项内容自适应的菜单宽度上限；超过才截断（截断项带 title）。 */
export const DROPDOWN_MENU_MAX_WIDTH_PX = 360

/**
 * 画布测字与实际排版的亚像素差（中文字形、缩放后取整）：实测“休闲”测得 26、排版 26.x，选中项被截成“休…”。
 * 菜单宽度统一多留这点余量。
 */
export const MENU_TEXT_ROUNDING_SLACK_PX = 2

/** 菜单最小宽度 = 最长选项文字 + 菜单项留白 + 浮层留白 + 取整余量，封顶 `DROPDOWN_MENU_MAX_WIDTH_PX`。 */
export function resolveDropdownMenuWidth(textWidth: number, size: keyof typeof UI_MENU_ITEM_HORIZONTAL_CHROME_PX): number {
  return Math.min(
    DROPDOWN_MENU_MAX_WIDTH_PX,
    Math.ceil(textWidth + UI_MENU_ITEM_HORIZONTAL_CHROME_PX[size] + DROPDOWN_PANEL_HORIZONTAL_CHROME_PX + MENU_TEXT_ROUNDING_SLACK_PX),
  )
}
