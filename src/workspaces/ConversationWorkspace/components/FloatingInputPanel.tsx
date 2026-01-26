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
      className="fixed bottom-6 left-1/2 transform -translate-x-1/2 w-[95%] max-w-5xl"
      style={{ zIndex: 20 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
    >
      <div
        className="bg-[#131313]/70 backdrop-blur-xl border border-zinc-700/50 rounded-2xl shadow-2xl hover:shadow-3xl cursor-pointer relative"
        style={{
          transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          maxHeight: isCollapsed || isCollapsing ? '52px' : '600px',
          minHeight: isCollapsed || isCollapsing ? '52px' : 'auto',
          opacity: 1,
          padding: isCollapsed || isCollapsing ? '12px 24px' : '16px',
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
            padding: '0 24px',
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-xs bg-[#007eff]/20 text-[#66b3ff] px-2 py-1 rounded whitespace-nowrap">
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
