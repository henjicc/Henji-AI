import { useLayoutEffect, useRef, type RefObject } from 'react'
import { resolveNodeToolbarPosition, type ToolbarSide } from './nodeToolbarPosition'
import { createRafScheduler } from '@/utils/createRafScheduler'
import { useCanvasSceneView } from '@/features/canvas/scene/useCanvasScene'

/** 仅修正选中态浮层，不改变 ReactFlow 节点盒、缩放或画布位置。 */
export function useNodeToolbarBoundary(nodeIdsKey: string, visible = true): RefObject<HTMLDivElement> {
  const panelRef = useRef<HTMLDivElement>(null)
  const sceneView = useCanvasSceneView()

  useLayoutEffect(() => {
    const panel = panelRef.current
    const toolbar = panel?.closest<HTMLElement>('.react-flow__node-toolbar')
    const renderer = toolbar?.closest<HTMLElement>('.react-flow__renderer')
    if (!panel || !toolbar || !renderer) return
    let side: ToolbarSide = 'above'
    let shift = { x: 0, y: 0 }
    const owner = panel.ownerDocument.defaultView ?? window
    const ids = (toolbar.dataset.id ?? '').split(' ')
    const update = () => {
      const area = renderer.getBoundingClientRect()
      const boundary = {
        left: Math.max(0, area.left), top: Math.max(0, area.top),
        width: Math.max(0, Math.min(owner.innerWidth, area.right) - Math.max(0, area.left)),
        height: Math.max(0, Math.min(owner.innerHeight, area.bottom) - Math.max(0, area.top)),
      }
      const maxWidth = `${Math.max(0, boundary.width - 24)}px`
      if (panel.style.maxWidth !== maxWidth) panel.style.maxWidth = maxWidth
      // 锚点取自画布场景：被选中的节点不一定挂着真 DOM（远景、移出视口），不能量节点元素
      const rect = sceneView.clientRectOf(ids)
      if (!rect) return
      const anchor = { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
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
    const scheduler = createRafScheduler(update, owner)
    const schedule = scheduler.schedule
    const resize = new ResizeObserver(schedule)
    ;[panel, renderer].forEach((element) => resize.observe(element))
    // 节点尺寸或位置变了，锚点跟着变
    const stopScene = sceneView.scene.subscribe(schedule)
    // ReactFlow 持有原始 transform；观察它的更新，并在独立 translate 中做边缘修正。
    let anchorTransform = toolbar.style.transform
    const mutations = new MutationObserver(() => {
      if (toolbar.style.transform === anchorTransform) return
      anchorTransform = toolbar.style.transform
      schedule()
    })
    mutations.observe(toolbar, { attributes: true, attributeFilter: ['style'] })
    update()
    owner.addEventListener('resize', schedule)
    return () => {
      toolbar.style.removeProperty('translate')
      resize.disconnect()
      stopScene()
      mutations.disconnect()
      scheduler.cancel()
      owner.removeEventListener('resize', schedule)
    }
  }, [nodeIdsKey, sceneView, visible])

  return panelRef
}
