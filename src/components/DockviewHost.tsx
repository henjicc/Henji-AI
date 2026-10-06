import { useRef, type ReactNode } from 'react'

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
 */
export function DockviewHost({ className = '', children }: { className?: string; children: ReactNode }): JSX.Element {
  const sashPress = useRef(false)
  return (
    <div
      className={`isolate ${className}`}
      onPointerDownCapture={(event) => {
        sashPress.current = event.target instanceof Element && event.target.closest('.dv-sash') !== null
      }}
      onPointerUpCapture={() => { sashPress.current = false }}
      onDragStartCapture={(event) => {
        if (sashPress.current) event.preventDefault()
      }}
    >
      {children}
    </div>
  )
}

