const ASSET_CHILD_OVERLAY_SELECTOR = [
  '[data-asset-card-menu]',
  '[data-asset-context-menu="true"]',
  '[data-dropdown-portal="true"]',
].join(', ')

/** Portal 挂到 document.body 后，仍然属于资产面板的交互浮层。 */
export function isAssetChildOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(ASSET_CHILD_OVERLAY_SELECTOR))
}

/** 有子浮层正在处理 Escape 时，外层资产视图不应抢先关闭。 */
export function hasOpenAssetChildOverlay(root: ParentNode = document): boolean {
  return Boolean(root.querySelector(
    '[data-asset-preview="open"], [data-asset-card-menu], [data-asset-context-menu="true"], [data-dropdown-portal="true"]',
  ))
}

/** 切换卡片菜单时，旧菜单的外部点击监听不能把新菜单延迟关闭。 */
export function isAssetCardMenuTriggerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-asset-card-menu-trigger]'))
}
