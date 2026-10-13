import React, { useEffect, useMemo } from 'react'
import { toDisplaySrc } from '@/platform/desktopApi'
import AudioPlayer from '@/components/AudioPlayer'
import { useDialogTransition } from '@/components/ui/useDialogTransition'
import { UI_DURATION, uiTransition } from '@/components/ui/motion'
import { isTopmostUiOverlay, UiOverlayLayerProvider, useUiOverlayLayer } from '@/components/ui'

export interface AudioViewerModalProps {
  open: boolean
  audioUrl: string
  filePath?: string
  onClose: () => void
  autoPlay?: boolean
}

export function AudioViewerModal({ open, audioUrl, filePath, onClose, autoPlay = false }: AudioViewerModalProps): JSX.Element | null {
  const { shouldRender: visible, isVisible, onTransitionEnd } = useDialogTransition(open, UI_DURATION.viewer)
  // 全屏查看器是模态浮层层（任务 4.3 / 5.9）：其上的子浮层先处理 Escape，查看器内点击不关掉打开它的面板
  const overlay = useUiOverlayLayer(open, { modal: true })
  const overlayOpacity = isVisible ? 1 : 0
  const playerOpacity = overlayOpacity
  const playbackUrl = useMemo(() => {
    const normalizedPath = filePath?.trim()
    if (normalizedPath) {
      return toDisplaySrc(normalizedPath.replace(/\\/g, '/'))
    }
    return audioUrl
  }, [audioUrl, filePath])

  useEffect(() => {
    if (!visible) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [visible])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && isTopmostUiOverlay(overlay.id)) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, overlay.id])

  if (!visible) return null

  return (
    <div
      className={/* ui-surface-allow: 全屏沉浸式媒体查看器，铺满视口，不是 UiModal 的居中卡片语义（见重要记录 003） */ "fixed inset-0 z-viewer flex items-center justify-center bg-media p-6"}
      style={{
        opacity: overlayOpacity,
        transition: uiTransition(['opacity'], UI_DURATION.viewer),
        pointerEvents: open ? 'auto' : 'none',
      }}
      // 收起中不可点击、对读屏隐藏；过渡结束即卸载，不只依赖计时器（任务 5.8）
      aria-hidden={!open || undefined}
      {...(!open ? { inert: '' } : {})}
      onTransitionEnd={onTransitionEnd}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      {...overlay.layerProps}
    >
      <UiOverlayLayerProvider id={overlay.id}>
      <div
        style={{
          opacity: playerOpacity * overlayOpacity,
          transform: `scale(${0.98 + 0.02 * playerOpacity})`,
          transition: uiTransition(['opacity', 'transform'], UI_DURATION.viewer),
        }}
      >
        <AudioPlayer src={playbackUrl} filePath={filePath} autoPlay={autoPlay} active={open} compact className="!w-[44rem] !max-w-[92vw]" />
      </div>
      </UiOverlayLayerProvider>
    </div>
  )
}
