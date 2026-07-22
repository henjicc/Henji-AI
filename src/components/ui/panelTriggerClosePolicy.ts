export type PanelClickClosePolicy = boolean | ((target: Node) => boolean) | undefined

/** Portal 内仍归属于当前交互面板的控件，不应触发面板外部点击关闭。 */
export function isPanelInteractionPortalTarget(element: Element | null): boolean {
  return Boolean(element?.closest(
    '[data-dropdown-portal="true"], [data-prompt-suggestion-portal="true"]',
  ))
}

/** 统一解析面板内部点击的关闭策略，未配置时按交互型面板处理。 */
export function shouldClosePanelAfterInternalClick(
  policy: PanelClickClosePolicy,
  target: Node,
): boolean {
  return typeof policy === 'function' ? policy(target) : policy === true
}
