import { forwardRef, useEffect, useRef, type ReactNode } from 'react'
import { UiBooleanAppearanceContext } from '@/components/ui/booleanAppearance'

/**
 * dockview 宿主外壳：剪辑工作区与 3D 镜头参考两个停靠布局共用（4.1 定位的两处同源缺陷）。
 *
 * 1. 层叠隔离放在 DockviewReact **外层**：dockview 把面板内容层（`.dv-render-overlay`，z-index 1）
 *    挂在 className 元素之外的 `.dv-shell` 上。隔离不加会让分隔条（z-index 99）漏到根层叠上下文、
 *    盖住 body 下的弹窗；只隔离 className 元素又会把分隔条关进下层，面板内容反盖住分隔条、拖不动。
 * 2. 主题类必须落到 `.dv-shell` 上（`dockviewHostTheme`，见 dockviewHostTheme.ts）：dockview 只给 shell 挂主题类，浮动分组挂在
 *    shell 下、className 元素之外，只在 className 元素上覆盖 `--dv-*` 时浮动分组仍是 abyss 的深蓝底，
 *    纸白下面板文字几乎不可读（4.1 对比度审计实测 1.1:1）。
 * 3. 按下分隔条后不允许启动原生拖放：分隔条压在面板边缘，Chromium 会把按下点下面的可拖动元素
 *    （剪辑素材面板的素材行等 `draggable` 元素）当成拖放源，指针一移出 4px 宽的分隔条就触发
 *    dragstart → pointercancel，dockview 的拖动随之中断，分隔条只能挪动第一下。
 * 4. 根元素是 PR 式拖放的宿主（`dockviewDocking.ts`）：窗口边缘停靠指示画在它里面，所以带 `relative`。
 * 5. 聚焦的面板组不画整圈描边，只靠当前标签下的强调色细线表示（index.css 的 .dv-active-tab）。
 * 6. 顶部留一道与面板间隙同宽同色的空隙（`.dockview-host`，index.css），面板组不贴着上方命令带。
 * 7. 停靠面板里的开关画成复选框外观（重要记录 022）：属性一列一列排，一排强调色滑块太抢注意力；其他地方仍是滑块开关。
 */

/** Dockview 的溢出菜单收纳不完整标签；滚动条边缘不再露出残字，缩窄后当前标签仍完整可见。 */
function useWholeDockTabs(host: React.RefObject<HTMLDivElement>): void {
  useEffect(() => {
    const root = host.current
    if (!root) return
    let pending = false
    let disposed = false
    let restoreFrame: number | undefined
    const strips = new Set<HTMLElement>()
    const update = (): void => {
      pending = false
      if (disposed) return
      for (const strip of root.querySelectorAll<HTMLElement>('.dv-tabs-container')) {
        if (!strips.has(strip)) { strips.add(strip); resize.observe(strip) }
        const tabs = Array.from(strip.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('dv-tab'))
        const active = tabs.find(tab => tab.classList.contains('dv-active-tab'))
        if (active && strip.clientWidth) {
          const bounds = strip.getBoundingClientRect(); const rect = active.getBoundingClientRect()
          if (rect.left < bounds.left || rect.right > bounds.right) strip.scrollLeft += rect.left < bounds.left ? rect.left - bounds.left : rect.right - bounds.right
        }
        const bounds = strip.getBoundingClientRect()
        for (const tab of tabs) {
          const rect = tab.getBoundingClientRect()
          const clipped = rect.left < bounds.left - .5 || rect.right > bounds.right + .5
          if (clipped !== tab.hasAttribute('data-dock-tab-clipped')) tab.toggleAttribute('data-dock-tab-clipped', clipped)
        }
      }
      for (const strip of strips) if (!root.contains(strip)) { resize.unobserve(strip); strips.delete(strip) }
    }
    const schedule = (): void => { if (!pending) { pending = true; queueMicrotask(update) } }
    const keepOuterScroll = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('.dv-tabs-overflow-container')) return
      const ancestors: Array<{ element: HTMLElement; top: number; left: number }> = []
      for (let element: HTMLElement | null = root; element; element = element.parentElement) ancestors.push({ element, top: element.scrollTop, left: element.scrollLeft })
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
      // 第三方菜单有独立 React root；原生捕获监听不依赖跨 root 的合成事件，布局提交后、绘制前恢复。
      restoreFrame = requestAnimationFrame(() => { restoreFrame = undefined; if (!disposed) for (const { element, top, left } of ancestors) { element.scrollTop = top; element.scrollLeft = left } })
    }
    const resize = new ResizeObserver(schedule)
    const mutations = new MutationObserver(records => {
      if (records.some(record => record.target instanceof Element && (record.target.matches('.dv-tab, .dv-tabs-container, .dv-groupview, .dv-view, .dv-shell') || record.target.closest('.dv-tabs-and-actions-container')))) schedule()
    })
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] })
    root.addEventListener('scroll', schedule, true)
    root.addEventListener('click', keepOuterScroll, true)
    schedule()
    return () => { disposed = true; mutations.disconnect(); resize.disconnect(); root.removeEventListener('scroll', schedule, true); root.removeEventListener('click', keepOuterScroll, true); if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame); strips.forEach(strip => strip.querySelectorAll('[data-dock-tab-clipped]').forEach(tab => tab.removeAttribute('data-dock-tab-clipped'))) }
  }, [host])
}

export const DockviewHost = forwardRef<HTMLDivElement, { className?: string; children: ReactNode }>(function DockviewHost({ className = '', children }, ref) {
  const sashPress = useRef(false)
  const host = useRef<HTMLDivElement | null>(null)
  useWholeDockTabs(host)
  return (
    <div
      ref={element => { host.current = element; if (typeof ref === 'function') ref(element); else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = element }}
      className={`dockview-host relative isolate ${className}`}
      onPointerDownCapture={(event) => {
        sashPress.current = event.target instanceof Element && event.target.closest('.dv-sash') !== null
      }}
      onPointerUpCapture={() => { sashPress.current = false }}
      onDragStartCapture={(event) => {
        if (sashPress.current) event.preventDefault()
      }}
    >
      <UiBooleanAppearanceContext.Provider value="checkbox">{children}</UiBooleanAppearanceContext.Provider>
    </div>
  )
})

