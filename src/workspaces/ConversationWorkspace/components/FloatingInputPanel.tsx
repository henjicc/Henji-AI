import React from 'react'
import { useI18n } from '@/hooks/useI18n'

interface FloatingInputPanelProps {
  containerRef: React.RefObject<HTMLDivElement>
  isCollapsed: boolean
  isCollapsing: boolean
  modelLabel: string
  prompt: string
  onExpand: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onMouseMove: () => void
  children: React.ReactNode
}

export function FloatingInputPanel({
  containerRef,
  isCollapsed,
  isCollapsing,
  modelLabel,
  prompt,
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
      className="fixed bottom-5 left-1/2 w-[95%] max-w-5xl -translate-x-1/2"
      style={{ zIndex: 20 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
    >
      <div
        className="relative cursor-pointer overflow-hidden rounded-[24px] border border-zinc-700/35 bg-zinc-950/68 shadow-[0_12px_34px_rgba(0,0,0,0.42)] backdrop-blur-xl"
        style={{
          transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          maxHeight: isCollapsed || isCollapsing ? '52px' : '600px',
          minHeight: isCollapsed || isCollapsing ? '52px' : 'auto',
          opacity: 1,
          padding: isCollapsed || isCollapsing ? '12px 22px' : '12px',
          overflow: isCollapsed && !isCollapsing ? 'visible' : 'hidden',
        }}
        onClick={() => {
          if (isCollapsed) onExpand()
        }}
      >
        <div
          className="absolute left-0 right-0"
          style={{
            top: isCollapsed || isCollapsing ? '12px' : '-60px',
            opacity: isCollapsed || isCollapsing ? 1 : 0,
            transition: 'opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), top 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            padding: '0 22px',
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-xs bg-accent/20 text-brand-300 px-2 py-1 rounded whitespace-nowrap">
                {displayModel}
              </span>
              <span className="text-sm text-zinc-300 truncate flex-1">
                {hintText}
              </span>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </div>
        </div>

        <div
          style={{
            opacity: !isCollapsed && !isCollapsing ? 1 : 0,
            transition: 'opacity 0.4s ease 0.15s',
            pointerEvents: !isCollapsed && !isCollapsing ? 'auto' : 'none',
            display: !isCollapsed || isCollapsing ? 'block' : 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

