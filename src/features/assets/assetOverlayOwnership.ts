import {
  hasAnyOpenUiOverlay,
  hasOpenUiOverlayDescendant,
  UI_OVERLAY_ID_ATTRIBUTE,
} from '@/components/ui/overlayOwnership'

/**
 * 资产面板的子浮层归属已收敛到通用浮层归属（`@/components/ui/overlayOwnership`，任务 4.3）：
 * 卡片菜单、右键菜单、下拉、视图设置、预览都是资产面板这一层的后代层，不再维护选择器白名单。
 */

/** 有子浮层正在处理 Escape 时，外层资产视图不应抢先关闭。 */
export function hasOpenAssetChildOverlay(root: ParentNode = document): boolean {
  const panelId = root.querySelector('[data-asset-floating-panel]')?.getAttribute(UI_OVERLAY_ID_ATTRIBUTE)
  // 资产工作区（非浮动面板）没有面板层：任一打开中的浮层都优先处理 Escape
  return panelId ? hasOpenUiOverlayDescendant(panelId) : hasAnyOpenUiOverlay()
}
