import { themeAbyss, type DockviewTheme } from 'dockview-react'
/**
 * 面板组之间露出的间隙宽度（像素），间隙底色是 `--dv-background-color`。四个停靠工作区共用一个值：
 * 宽了界面像一个个盒子摆在黑底上，不像一整块工作台。index.css 里 `.dockview-host` 顶部留白与它同宽。
 */
const DOCK_PANEL_GAP_PX = 2
/**
 * 停靠布局主题：沿用 abyss 的结构样式，再把项目的覆盖类（`--dv-*` 改接主题令牌，见 index.css）挂到 shell 上，
 * 主网格、边缘分组与浮动分组都从 shell 继承同一套变量。
 * 停靠指示以整个面板组（含标签栏）为范围：编组时整组着色，停靠时是整组那条边的窄带（PR 录屏，见 dockviewDocking.ts）。
 */
export function dockviewHostTheme(classNames: string): DockviewTheme {
  return { ...themeAbyss, className: `${themeAbyss.className} ${classNames}`, dndPanelOverlay: 'group', gap: DOCK_PANEL_GAP_PX }
}
