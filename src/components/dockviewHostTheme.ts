import { themeAbyss, type DockviewTheme } from 'dockview-react'
/**
 * 停靠布局主题：沿用 abyss 的结构样式，再把项目的覆盖类（`--dv-*` 改接主题令牌，见 index.css）挂到 shell 上，
 * 主网格、边缘分组与浮动分组都从 shell 继承同一套变量。
 */
export function dockviewHostTheme(classNames: string): DockviewTheme {
  return { ...themeAbyss, className: `${themeAbyss.className} ${classNames}` }
}
