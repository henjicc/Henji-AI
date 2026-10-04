export type PanelClickClosePolicy = boolean | ((target: Node) => boolean) | undefined

/**
 * 统一解析面板内部点击的关闭策略，未配置时按交互型面板处理。
 * 子浮层里的点击是否归属本面板由 `overlayOwnership` 判定（任务 4.3 收敛原 portal 白名单）。
 */
export function shouldClosePanelAfterInternalClick(
  policy: PanelClickClosePolicy,
  target: Node,
): boolean {
  return typeof policy === 'function' ? policy(target) : policy === true
}
