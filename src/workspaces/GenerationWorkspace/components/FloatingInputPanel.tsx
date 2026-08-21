import React from 'react'
import { UiPanel } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { UI_DURATION, uiTransition } from '@/components/ui/motion'
import { ChevronUp } from 'lucide-react'

interface FloatingInputPanelProps {
  containerRef: React.RefObject<HTMLDivElement>
  compact: boolean
  isCollapsed: boolean
  isCollapsing: boolean
  modelLabel: string
  prompt: string
  maxWidthPx?: number
  viewportGutterPx?: number
  onExpand: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onMouseMove: () => void
  children: React.ReactNode
}

export function FloatingInputPanel({
  containerRef,
  compact,
  isCollapsed,
  isCollapsing,
  modelLabel,
  prompt,
  maxWidthPx = 1320,
  viewportGutterPx = 20,
  onExpand,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  children,
}: FloatingInputPanelProps): JSX.Element {
  const { t } = useI18n()
  const hintText = prompt.trim() ? prompt : t('ui:workspace.panelHint')
  const displayModel = modelLabel || t('models:selectModel')

  return (
    <div
      ref={containerRef}
      className="absolute bottom-5 left-1/2 z-panel -translate-x-1/2"
      style={{
        width: `min(calc(100% - ${viewportGutterPx * 2}px), ${maxWidthPx}px)`,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      data-layout-density={compact ? 'compact' : 'comfortable'}
    >
      <UiPanel
        variant="glass"
        className="relative cursor-pointer overflow-hidden !rounded-3xl"
        style={{
          transition: uiTransition(['max-height'], UI_DURATION.slow),
          maxHeight: isCollapsed || isCollapsing ? '52px' : '600px',
          minHeight: isCollapsed || isCollapsing ? '52px' : 'auto',
          opacity: 1,
          padding: compact ? '8px' : '12px',
          overflow: isCollapsed && !isCollapsing ? 'visible' : 'hidden',
        }}
        onClick={() => {
          if (isCollapsed) onExpand()
        }}
      >
        <div
          className="absolute left-0 right-0"
          style={{
            // 位移走 transform 而不是过渡 top：top 是布局属性，过渡期间每帧重排；
            // translateY 只走合成器。12px → -60px 等价于位移 -72px。
            top: '12px',
            transform: isCollapsed || isCollapsing ? 'translateY(0)' : 'translateY(-72px)',
            opacity: isCollapsed || isCollapsing ? 1 : 0,
            transition: uiTransition(['opacity', 'transform'], UI_DURATION.slow),
            padding: isCollapsed || isCollapsing ? '0 32px' : '0 22px',
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-xs bg-accent/20 text-brand-300 px-2 py-1 rounded whitespace-nowrap">
                {displayModel}
              </span>
              <span className="text-sm text-text-muted truncate flex-1">
                {hintText}
              </span>
            </div>
            <ChevronUp className="h-5 w-5 text-text-muted" />
          </div>
        </div>

        <div
          className="relative rounded-[inherit]"
          style={{
            opacity: !isCollapsed && !isCollapsing ? 1 : 0,
            transition: uiTransition(['opacity'], UI_DURATION.slow, UI_DURATION.fast),
            pointerEvents: !isCollapsed && !isCollapsing ? 'auto' : 'none',
            display: !isCollapsed || isCollapsing ? 'block' : 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </UiPanel>
    </div>
  )
}
