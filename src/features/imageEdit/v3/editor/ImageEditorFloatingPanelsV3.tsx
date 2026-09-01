import { ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { UiIconButton } from '@/components/ui'

import { ImageEditorLayersPanelV3 } from './ImageEditorLayersPanelV3'
import { ImageEditorPropertiesPanelV3 } from './ImageEditorPropertiesPanelV3'
import type { ImageEditorV3Controller } from './types'

interface PanelPositionV3 { left: number; top: number }

interface DragStateV3 {
  pointerId: number
  startClientX: number
  startClientY: number
  startLeft: number
  startTop: number
}

function FloatingPanelV3({
  workspaceRef,
  title,
  expandLabel,
  collapseLabel,
  initialRight,
  widthClass,
  heightClass,
  children,
}: {
  workspaceRef: RefObject<HTMLDivElement>
  title: string
  expandLabel: string
  collapseLabel: string
  initialRight: number
  widthClass: string
  heightClass: string
  children: ReactNode
}): JSX.Element {
  const panelRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<DragStateV3 | null>(null)
  const [position, setPosition] = useState<PanelPositionV3 | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || !event.isPrimary) return
    const panel = panelRef.current
    const workspace = workspaceRef.current
    if (!panel || !workspace) return
    const panelRect = panel.getBoundingClientRect()
    const workspaceRect = workspace.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: panelRect.left - workspaceRect.left,
      startTop: panelRect.top - workspaceRect.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    const panel = panelRef.current
    const workspace = workspaceRef.current
    if (!drag || drag.pointerId !== event.pointerId || !panel || !workspace) return
    const workspaceRect = workspace.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const next = {
      left: Math.min(
        Math.max(8, workspaceRect.width - panelRect.width - 8),
        Math.max(8, drag.startLeft + event.clientX - drag.startClientX),
      ),
      top: Math.min(
        Math.max(8, workspaceRect.height - 32),
        Math.max(8, drag.startTop + event.clientY - drag.startClientY),
      ),
    }
    setPosition(next)
  }

  const finishDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <section
      ref={panelRef}
      data-floating-editor-panel
      className={`ui-glass ui-glass-elevated pointer-events-auto absolute z-panel ${widthClass} overflow-hidden rounded-xl ${collapsed ? '' : heightClass}`}
      style={position
        ? { left: position.left, top: position.top }
        : { right: initialRight, top: 12 }}
    >
      <header
        data-floating-panel-handle
        className="relative z-raised flex h-8 cursor-grab items-center gap-2 border-b border-border-dark/60 px-2 active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <GripHorizontal className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-dark">{title}</span>
        <UiIconButton
          className="h-6 w-6"
          showBorder={false}
          appearance="hover-only"
          aria-label={collapsed ? expandLabel : collapseLabel}
          aria-expanded={!collapsed}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed
            ? <ChevronDown className="h-3.5 w-3.5" />
            : <ChevronUp className="h-3.5 w-3.5" />}
        </UiIconButton>
      </header>
      {!collapsed ? <div className="flex min-h-0 h-[calc(100%-2rem)]">{children}</div> : null}
    </section>
  )
}

export function ImageEditorFloatingPanelsV3({
  controller,
  workspaceRef,
  showLayers,
  showProperties,
}: {
  controller: ImageEditorV3Controller
  workspaceRef: RefObject<HTMLDivElement>
  showLayers: boolean
  showProperties: boolean
}): JSX.Element {
  const { t } = useTranslation('ui')
  return (
    <div className="pointer-events-none absolute inset-0 z-panel">
      {showLayers ? (
        <FloatingPanelV3
          workspaceRef={workspaceRef}
          title={t('imageEditor.v3.layers.title')}
          expandLabel={t('imageEditor.v3.panels.expand', { title: t('imageEditor.v3.layers.title') })}
          collapseLabel={t('imageEditor.v3.panels.collapse', { title: t('imageEditor.v3.layers.title') })}
          initialRight={showProperties ? 420 : 12}
          widthClass="w-60"
          heightClass="h-[min(52vh,34rem)]"
        >
          <ImageEditorLayersPanelV3 controller={controller} embedded />
        </FloatingPanelV3>
      ) : null}
      {showProperties ? (
        <FloatingPanelV3
          workspaceRef={workspaceRef}
          title={t('imageEditor.v3.properties.title')}
          expandLabel={t('imageEditor.v3.panels.expand', { title: t('imageEditor.v3.properties.title') })}
          collapseLabel={t('imageEditor.v3.panels.collapse', { title: t('imageEditor.v3.properties.title') })}
          initialRight={12}
          widthClass="w-[25rem]"
          heightClass="h-[min(72vh,42rem)]"
        >
          <ImageEditorPropertiesPanelV3 controller={controller} embedded />
        </FloatingPanelV3>
      ) : null}
    </div>
  )
}
