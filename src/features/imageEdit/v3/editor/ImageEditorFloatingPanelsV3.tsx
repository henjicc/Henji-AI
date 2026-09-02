import { ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton, UiPanel } from '@/components/ui'

import { ImageEditorLayersPanelV3 } from './ImageEditorLayersPanelV3'
import {
  clampImageEditorFloatingPanelPositionV3,
  resolveImageEditorPanelDockEdgeV3,
  resolveImageEditorPanelDockIndexV3,
  type ImageEditorFloatingPanelPositionV3,
  type ImageEditorPanelDockEdgeV3,
  type ImageEditorPanelIdV3,
} from './imageEditorPanelLayoutV3'
import { ImageEditorPropertiesPanelV3 } from './ImageEditorPropertiesPanelV3'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorDockResizeV3 } from './useImageEditorDockResizeV3'

interface PanelLayoutV3 {
  mode: 'floating' | 'docked'
  edge: ImageEditorPanelDockEdgeV3 | null
  position: ImageEditorFloatingPanelPositionV3
}

interface PanelDragStateV3 {
  panelId: ImageEditorPanelIdV3
  pointerId: number
  startClientX: number
  startClientY: number
  startPosition: ImageEditorFloatingPanelPositionV3
  currentPosition: ImageEditorFloatingPanelPositionV3
  size: { width: number; height: number }
}

interface PanelDockPreviewV3 {
  edge: ImageEditorPanelDockEdgeV3
  index: number
  siblingCount: number
}

type PanelLayoutsV3 = Record<ImageEditorPanelIdV3, PanelLayoutV3>
type PanelDockOrdersV3 = Record<ImageEditorPanelDockEdgeV3, ImageEditorPanelIdV3[]>

const FLOATING_PANEL_WIDTH: Record<ImageEditorPanelIdV3, number> = {
  layers: 240,
  properties: 400,
}

const INITIAL_PANEL_LAYOUTS: PanelLayoutsV3 = {
  layers: { mode: 'docked', edge: 'right', position: { left: 24, top: 24 } },
  properties: { mode: 'docked', edge: 'right', position: { left: 280, top: 24 } },
}

const INITIAL_DOCK_ORDERS: PanelDockOrdersV3 = {
  left: [],
  right: ['layers', 'properties'],
}

function removePanelFromDockOrdersV3(
  orders: PanelDockOrdersV3,
  panelId: ImageEditorPanelIdV3,
): PanelDockOrdersV3 {
  return {
    left: orders.left.filter((id) => id !== panelId),
    right: orders.right.filter((id) => id !== panelId),
  }
}

function insertPanelIntoDockOrdersV3(
  orders: PanelDockOrdersV3,
  edge: ImageEditorPanelDockEdgeV3,
  panelId: ImageEditorPanelIdV3,
  index: number,
): PanelDockOrdersV3 {
  const withoutPanel = removePanelFromDockOrdersV3(orders, panelId)
  const next = [...withoutPanel[edge]]
  next.splice(Math.max(0, Math.min(index, next.length)), 0, panelId)
  return { ...withoutPanel, [edge]: next }
}

function PanelContentV3({
  panelId,
  controller,
}: {
  panelId: ImageEditorPanelIdV3
  controller: ImageEditorV3Controller
}): JSX.Element {
  return panelId === 'layers'
    ? <ImageEditorLayersPanelV3 controller={controller} embedded />
    : <ImageEditorPropertiesPanelV3 controller={controller} embedded />
}

export function ImageEditorFloatingPanelsV3({
  controller,
  showLayers,
  showProperties,
  children,
}: {
  controller: ImageEditorV3Controller
  showLayers: boolean
  showProperties: boolean
  children: ReactNode
}): JSX.Element {
  const { t } = useTranslation('ui')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRefs = useRef<Record<ImageEditorPanelIdV3, HTMLDivElement | null>>({
    layers: null,
    properties: null,
  })
  const dragRef = useRef<PanelDragStateV3 | null>(null)
  const layoutsRef = useRef<PanelLayoutsV3>(INITIAL_PANEL_LAYOUTS)
  const dockOrdersRef = useRef<PanelDockOrdersV3>(INITIAL_DOCK_ORDERS)
  const dockPreviewRef = useRef<PanelDockPreviewV3 | null>(null)
  const [layouts, setLayouts] = useState<PanelLayoutsV3>(INITIAL_PANEL_LAYOUTS)
  const [dockOrders, setDockOrders] = useState<PanelDockOrdersV3>(INITIAL_DOCK_ORDERS)
  const [collapsed, setCollapsed] = useState<Record<ImageEditorPanelIdV3, boolean>>({
    layers: false,
    properties: false,
  })
  const [dockPreview, setDockPreview] = useState<PanelDockPreviewV3 | null>(null)
  const {
    dockRefs,
    dockWidths,
    dockSplits,
    startResize,
    adjustWidth,
    adjustSplit,
  } = useImageEditorDockResizeV3(rootRef)

  const visiblePanelIds = useMemo(() => [
    ...(showLayers ? ['layers'] as const : []),
    ...(showProperties ? ['properties'] as const : []),
  ], [showLayers, showProperties])

  const commitLayouts = (next: PanelLayoutsV3): void => {
    layoutsRef.current = next
    setLayouts(next)
  }
  const commitDockOrders = (next: PanelDockOrdersV3): void => {
    dockOrdersRef.current = next
    setDockOrders(next)
  }
  const updateDockPreview = (next: PanelDockPreviewV3 | null): void => {
    const current = dockPreviewRef.current
    if (current?.edge === next?.edge
      && current?.index === next?.index
      && current?.siblingCount === next?.siblingCount) return
    dockPreviewRef.current = next
    setDockPreview(next)
  }

  useEffect(() => {
    const finishDrag = (event: PointerEvent, cancelled: boolean): void => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const preview = cancelled ? null : dockPreviewRef.current
      if (preview) {
        commitLayouts({
          ...layoutsRef.current,
          [drag.panelId]: {
            ...layoutsRef.current[drag.panelId],
            mode: 'docked',
            edge: preview.edge,
          },
        })
        commitDockOrders(insertPanelIntoDockOrdersV3(
          dockOrdersRef.current,
          preview.edge,
          drag.panelId,
          preview.index,
        ))
      } else {
        commitLayouts({
          ...layoutsRef.current,
          [drag.panelId]: {
            mode: 'floating',
            edge: null,
            position: drag.currentPosition,
          },
        })
      }
      dragRef.current = null
      updateDockPreview(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const drag = dragRef.current
      const root = rootRef.current
      if (!drag || drag.pointerId !== event.pointerId || !root) return
      const rootRect = root.getBoundingClientRect()
      const panel = panelRefs.current[drag.panelId]
      const measured = panel?.getBoundingClientRect()
      const size = measured
        ? { width: measured.width, height: measured.height }
        : drag.size
      const position = clampImageEditorFloatingPanelPositionV3({
        left: drag.startPosition.left + event.clientX - drag.startClientX,
        top: drag.startPosition.top + event.clientY - drag.startClientY,
      }, size, rootRect)
      drag.currentPosition = position
      if (panel) {
        panel.style.left = `${position.left}px`
        panel.style.top = `${position.top}px`
      }
      const edge = resolveImageEditorPanelDockEdgeV3(position, size, rootRect)
      if (!edge) {
        updateDockPreview(null)
        return
      }
      const siblingIds = dockOrdersRef.current[edge].filter((id) => (
        id !== drag.panelId && visiblePanelIds.includes(id)
      ))
      const siblingCenters = siblingIds.map((id) => {
        const rect = panelRefs.current[id]?.getBoundingClientRect()
        return rect ? rect.top + rect.height / 2 : rootRect.top + rootRect.height / 2
      })
      updateDockPreview({
        edge,
        index: resolveImageEditorPanelDockIndexV3(event.clientY, siblingCenters),
        siblingCount: siblingIds.length,
      })
    }

    const handlePointerUp = (event: PointerEvent): void => finishDrag(event, false)
    const handlePointerCancel = (event: PointerEvent): void => finishDrag(event, true)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [visiblePanelIds])

  const startPanelDrag = (
    panelId: ImageEditorPanelIdV3,
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return
    const root = rootRef.current
    const panel = panelRefs.current[panelId]
    if (!root || !panel) return
    const rootRect = root.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const current = layoutsRef.current[panelId]
    const targetWidth = current.mode === 'docked'
      ? FLOATING_PANEL_WIDTH[panelId]
      : panelRect.width
    const grabRatio = Math.max(0, Math.min(1, (event.clientX - panelRect.left) / panelRect.width))
    const startPosition = clampImageEditorFloatingPanelPositionV3({
      left: current.mode === 'docked'
        ? event.clientX - rootRect.left - grabRatio * targetWidth
        : panelRect.left - rootRect.left,
      top: panelRect.top - rootRect.top,
    }, { width: targetWidth, height: panelRect.height }, rootRect)
    commitLayouts({
      ...layoutsRef.current,
      [panelId]: { mode: 'floating', edge: null, position: startPosition },
    })
    commitDockOrders(removePanelFromDockOrdersV3(dockOrdersRef.current, panelId))
    dragRef.current = {
      panelId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition,
      currentPosition: startPosition,
      size: { width: targetWidth, height: panelRect.height },
    }
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    event.preventDefault()
  }

  const titleForPanel = (panelId: ImageEditorPanelIdV3): string => (
    panelId === 'layers'
      ? t('imageEditor.v3.layers.title')
      : t('imageEditor.v3.properties.title')
  )

  const panelBody = (panelId: ImageEditorPanelIdV3): ReactNode => {
    const title = titleForPanel(panelId)
    return (
      <>
        <header
          data-editor-panel-handle
          data-floating-panel-handle
          className="relative z-raised flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-border-dark/60 px-2 active:cursor-grabbing"
          onPointerDown={(event) => startPanelDrag(panelId, event)}
        >
          <GripHorizontal className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-dark">{title}</span>
          <UiIconButton
            className="h-6 w-6"
            showBorder={false}
            appearance="hover-only"
            aria-label={collapsed[panelId]
              ? t('imageEditor.v3.panels.expand', { title })
              : t('imageEditor.v3.panels.collapse', { title })}
            aria-expanded={!collapsed[panelId]}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setCollapsed((current) => ({
              ...current,
              [panelId]: !current[panelId],
            }))}
          >
            {collapsed[panelId]
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronUp className="h-3.5 w-3.5" />}
          </UiIconButton>
        </header>
        {!collapsed[panelId] ? (
          <div className="flex min-h-0 flex-1">
            <PanelContentV3 panelId={panelId} controller={controller} />
          </div>
        ) : null}
      </>
    )
  }

  const renderPanel = (panelId: ImageEditorPanelIdV3): JSX.Element => {
    const layout = layouts[panelId]
    const commonProps = {
      'data-editor-panel': true,
      'data-editor-panel-id': panelId,
      'data-panel-mode': layout.mode,
      'data-panel-dock-edge': layout.edge ?? undefined,
    }
    if (layout.mode === 'floating') {
      return (
        <UiPanel
          key={panelId}
          ref={(node) => { panelRefs.current[panelId] = node }}
          variant="glass"
          {...commonProps}
          data-floating-editor-panel
          className={`pointer-events-auto absolute z-panel flex min-h-32 min-w-60 max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] resize flex-col overflow-hidden ${
            panelId === 'layers' ? 'w-60' : 'w-[25rem]'
          } ${collapsed[panelId] ? 'h-8' : panelId === 'layers' ? 'h-[min(52vh,34rem)]' : 'h-[min(72vh,42rem)]'}`}
          style={{ left: layout.position.left, top: layout.position.top }}
        >
          {panelBody(panelId)}
        </UiPanel>
      )
    }
    return (
      <div
        key={panelId}
        ref={(node) => { panelRefs.current[panelId] = node }}
        {...commonProps}
        data-docked-editor-panel
        className={`relative flex min-h-0 w-full flex-col overflow-hidden ${
          collapsed[panelId] ? 'h-8 shrink-0' : 'flex-1'
        }`}
      >
        {panelBody(panelId)}
      </div>
    )
  }

  const renderDock = (edge: ImageEditorPanelDockEdgeV3): JSX.Element | null => {
    const panelIds = dockOrders[edge].filter((id) => (
      visiblePanelIds.includes(id)
      && layouts[id].mode === 'docked'
      && layouts[id].edge === edge
    ))
    if (panelIds.length === 0) return null
    const expandedPanelIds = panelIds.filter((panelId) => !collapsed[panelId])
    const splitActive = expandedPanelIds.length === 2
    return (
      <aside
        ref={(node) => { dockRefs.current[edge] = node }}
        data-editor-panel-dock={edge}
        aria-label={t(`imageEditor.v3.panels.${edge}Dock`)}
        className={`relative z-raised flex shrink-0 flex-col overflow-hidden bg-panel ${
          edge === 'left' ? 'border-r border-border-dark' : 'border-l border-border-dark'
        }`}
        style={{ width: dockWidths[edge], maxWidth: '55%' }}
      >
        {panelIds.flatMap((panelId) => {
          const expandedIndex = expandedPanelIds.indexOf(panelId)
          const section = (
            <div
              key={panelId}
              className={`flex min-h-0 ${collapsed[panelId] ? 'h-8 shrink-0' : ''}`}
              style={!collapsed[panelId] && splitActive ? {
                flex: `0 0 calc(${(expandedIndex === 0 ? dockSplits[edge] : 1 - dockSplits[edge]) * 100}% - 4px)`,
              } : !collapsed[panelId] ? { flex: '1 1 0%' } : undefined}
            >
              {renderPanel(panelId)}
            </div>
          )
          if (!splitActive || expandedIndex !== 0) return [section]
          return [section, (
            <div
              key={`${edge}-split-resize`}
              role="separator"
              aria-orientation="horizontal"
              aria-label={t('imageEditor.v3.panels.resizeSections')}
              aria-valuenow={Math.round(dockSplits[edge] * 100)}
              tabIndex={0}
              data-panel-resize-axis="vertical"
              className="group relative z-drag h-2 shrink-0 cursor-row-resize"
              style={{ touchAction: 'none' }}
              onPointerDown={(event) => startResize('dock-split', edge, event)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                adjustSplit(edge, event.key === 'ArrowDown' ? 0.05 : -0.05)
              }}
            >
              <span className="absolute inset-x-0 top-1/2 h-px bg-border-dark group-hover:bg-accent group-focus-visible:bg-accent" />
            </div>
          )]
        })}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('imageEditor.v3.panels.resizeWidth')}
          tabIndex={0}
          data-panel-resize-axis="horizontal"
          className={`absolute inset-y-0 z-drag w-2 cursor-col-resize ${edge === 'left' ? 'right-0' : 'left-0'}`}
          style={{ touchAction: 'none' }}
          onPointerDown={(event) => startResize('dock-width', edge, event)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const direction = event.key === 'ArrowRight' ? 1 : -1
            const delta = edge === 'left' ? direction * 16 : direction * -16
            adjustWidth(edge, delta)
          }}
        />
      </aside>
    )
  }

  const floatingPanelIds = visiblePanelIds.filter((id) => layouts[id].mode === 'floating')
  const dockPreviewVerticalClass = dockPreview?.siblingCount === 1
    ? dockPreview.index === 0 ? 'top-2 bottom-1/2' : 'top-1/2 bottom-2'
    : 'inset-y-2'

  return (
    <div ref={rootRef} data-editor-panel-workspace className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {renderDock('left')}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
      {renderDock('right')}
      <div className="pointer-events-none absolute inset-0 z-panel">
        {floatingPanelIds.map(renderPanel)}
      </div>
      {dockPreview ? (
        <div
          data-editor-panel-dock-preview={dockPreview.edge}
          aria-label={t(`imageEditor.v3.panels.${dockPreview.edge}DockPreview`)}
          className={`pointer-events-none absolute z-drag w-[25rem] max-w-[42%] border border-veil-strong bg-veil-faint ${
            dockPreview.edge === 'left' ? 'left-0' : 'right-0'
          } ${dockPreviewVerticalClass}`}
          style={{ width: dockWidths[dockPreview.edge] }}
        />
      ) : null}
    </div>
  )
}
