import { forwardRef, useEffect, useRef, type ReactNode } from 'react'

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
 * 5. 激活面板组的强调色描边（PR 式）画在宿主里一层独立的框上，跟踪 `.dv-active-group` 的位置：面板内容层
 *    `.dv-render-overlay` 按 dockview 每帧缓存的内容区矩形定位，会盖住组自身的边框或组内伪元素，CSS 描边不可靠。
 *    这层框在内容层（z 1）之上、分隔条（z 99）之下，用 z-raised，不接收指针。
 * 6. 顶部留一道与面板间隙同宽同色的空隙（`.dockview-host`，index.css），面板组不贴着上方命令带。
 */
function ActiveGroupOutline({ host }: { host: React.RefObject<HTMLDivElement> }): React.ReactElement {
  const outline = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = host.current; const box = outline.current
    if (!root || !box) return
    let pending = false
    const place = (): void => {
      pending = false
      const group = root.querySelector('.dv-groupview.dv-active-group')
      const rect = group?.getBoundingClientRect()
      if (!rect || !rect.width || !rect.height) { box.style.display = 'none'; return }
      const origin = root.getBoundingClientRect()
      Object.assign(box.style, { display: '', left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    }
    // 用微任务合并同一批变化，不等下一帧：窗口在后台时 requestAnimationFrame 会暂停，描边会落后一步。
    const schedule = (): void => { if (!pending) { pending = true; queueMicrotask(place) } }
    // dockview 用 class 标激活组、用内联 style 摆放各视图和浮动组，只对这几类元素的变化重算；面板内部（如回放时
    // 每帧改 style 的时间线）的变化直接忽略，避免回放中反复强制布局。尺寸变化另由 ResizeObserver 兜底。
    const layoutTarget = (node: Node): boolean => node instanceof Element && (node.classList.contains('dv-groupview') || node.classList.contains('dv-view') || node.classList.contains('dv-resize-container'))
    const mutations = new MutationObserver(records => { if (records.some(record => layoutTarget(record.target))) schedule() })
    mutations.observe(root, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    schedule()
    return () => { mutations.disconnect(); resize.disconnect() }
  }, [host])
  return <div ref={outline} aria-hidden="true" data-dock-active-outline className="dock-active-outline pointer-events-none absolute z-raised" style={{ display: 'none' }} />
}

export const DockviewHost = forwardRef<HTMLDivElement, { className?: string; children: ReactNode }>(function DockviewHost({ className = '', children }, ref) {
  const sashPress = useRef(false)
  const host = useRef<HTMLDivElement | null>(null)
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
      {children}
      <ActiveGroupOutline host={host} />
    </div>
  )
})

