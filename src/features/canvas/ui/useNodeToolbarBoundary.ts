import { useLayoutEffect, useRef } from 'react'
import { resolveNodeToolbarPosition, type ToolbarSide } from './nodeToolbarPosition'

/** 仅修正选中态浮层，不改变 ReactFlow 节点盒、缩放或画布位置。 */
export function useNodeToolbarBoundary(nodeIdsKey: string, visible = true) {
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const panel = panelRef.current
    const toolbar = panel?.closest<HTMLElement>('.react-flow__node-toolbar')
    const renderer = toolbar?.closest<HTMLElement>('.react-flow__renderer')
    if (!panel || !toolbar || !renderer) return
    let side: ToolbarSide = 'above'
    let shift = { x: 0, y: 0 }
    let frame = 0
    const ids = new Set((toolbar.dataset.id ?? '').split(' '))
    const nodes = Array.from(renderer.querySelectorAll<HTMLElement>('.react-flow__node')).filter((node) => ids.has(node.dataset.id ?? ''))
    const update = () => {
      frame = 0
      const area = renderer.getBoundingClientRect()
      const boundary = {
        left: Math.max(0, area.left), top: Math.max(0, area.top),
        width: Math.max(0, Math.min(window.innerWidth, area.right) - Math.max(0, area.left)),
        height: Math.max(0, Math.min(window.innerHeight, area.bottom) - Math.max(0, area.top)),
      }
      const maxWidth = `${Math.max(0, boundary.width - 24)}px`
      if (panel.style.maxWidth !== maxWidth) panel.style.maxWidth = maxWidth
      const rects = nodes.map((node) => node.getBoundingClientRect())
      if (!rects.length) return
      const left = Math.min(...rects.map((rect) => rect.left))
      const top = Math.min(...rects.map((rect) => rect.top))
      const anchor = { left, top, width: Math.max(...rects.map((rect) => rect.right)) - left, height: Math.max(...rects.map((rect) => rect.bottom)) - top }
      const natural = toolbar.getBoundingClientRect()
      const next = resolveNodeToolbarPosition(anchor, natural, boundary, side, Boolean(panel.querySelector('[aria-expanded="true"]')))
      // 菜单打开时保持已有一侧；边界夹取仍然生效，防止窗口缩小时越界。
      side = next.side
      const x = next.left - (natural.left - shift.x)
      const y = next.top - (natural.top - shift.y)
      const translate = `${x}px ${y}px`
      if (toolbar.style.translate !== translate) toolbar.style.translate = translate
      toolbar.dataset.toolbarSide = side
      shift = { x, y }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const resize = new ResizeObserver(schedule)
    ;[panel, renderer, ...nodes].forEach((element) => resize.observe(element))
    // ReactFlow 持有原始 transform；观察它的更新，并在独立 translate 中做边缘修正。
    let anchorTransform = toolbar.style.transform
    const mutations = new MutationObserver(() => {
      if (toolbar.style.transform === anchorTransform) return
      anchorTransform = toolbar.style.transform
      schedule()
    })
    mutations.observe(toolbar, { attributes: true, attributeFilter: ['style'] })
    update()
    window.addEventListener('resize', schedule)
    return () => {
      toolbar.style.removeProperty('translate')
      resize.disconnect()
      mutations.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
    }
  }, [nodeIdsKey, visible])

  return panelRef
}
