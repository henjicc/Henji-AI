import { createContext, useEffect, type RefObject } from 'react'
import type { UiControlSize } from './primitiveInternals'

/** 命令带组合处决定宿主主动作是否让位；默认保持调用方声明的层级。 */
export const UiPrimaryActionContext = createContext(true)

export const actionGroupContext = createContext<{ tier: 'secondary' | 'quiet'; size: UiControlSize } | null>(null)

/** 以实际 DOM 可见性计预算，避免隐藏工作区、互斥分支和 portal 弹窗被重复计数。仅开发构建订阅。 */
export function useUiPrimaryBudget(root: RefObject<HTMLElement>, enabled = true): void {
  useEffect(() => {
    const host = root.current
    if (!import.meta.env.DEV || !enabled || !host) return
    const boundary = '[role="dialog"], [data-command-bar], [data-ui-toolbar], [data-application-surface-id]'
    const view = host.ownerDocument.defaultView
    if (!view) return
    const warned = new WeakSet<Element>()
    const check = () => {
      const counts = new Map<Element, number>()
      for (const button of host.querySelectorAll('[data-variant="primary"], [data-tone="accent"]')) {
        let visible = true
        for (let node: Element | null = button; node; node = node.parentElement) {
          const style = view.getComputedStyle(node)
          if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') { visible = false; break }
        }
        const owner = button.closest(boundary)
        const count = visible && owner ? (counts.get(owner) ?? 0) + 1 : 0
        if (owner && visible) counts.set(owner, count)
        button.toggleAttribute('data-primary-overflow', count > 1)
        if (count > 1 && !warned.has(button)) {
          warned.add(button)
          // eslint-disable-next-line no-console -- 任务 5.2 要求开发模式直接提示组件主动作预算冲突，不写用户日志。
          console.warn('[ui] 同一表面出现多个主动作', button)
        }
      }
      for (const old of host.querySelectorAll('[data-primary-overflow]:not([data-variant="primary"]):not([data-tone="accent"])')) old.removeAttribute('data-primary-overflow')
    }
    check()
    const observer = new view.MutationObserver(check)
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-variant', 'data-tone'] })
    return () => observer.disconnect()
  }, [root, enabled])
}
