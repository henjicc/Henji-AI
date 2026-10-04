import React, { useEffect, useMemo, useRef, useState } from 'react'
import { toDisplaySrc } from '@/platform/desktopApi'
import AudioPlayer from '@/components/AudioPlayer'
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
  const [visible, setVisible] = useState(open)
  // 全屏查看器是模态浮层层（任务 4.3 / 5.9）：其上的子浮层先处理 Escape，查看器内点击不关掉打开它的面板
  const overlay = useUiOverlayLayer(open, { modal: true })
  const [overlayOpacity, setOverlayOpacity] = useState(0)
  const [playerOpacity, setPlayerOpacity] = useState(0)
  const closeTimerRef = useRef<number | null>(null)
  const playbackUrl = useMemo(() => {
    const normalizedPath = filePath?.trim()
    if (normalizedPath) {
      return toDisplaySrc(normalizedPath.replace(/\\/g, '/'))
    }
    return audioUrl
  }, [audioUrl, filePath])

  useEffect(() => {
    if (open) {
      setVisible(true)
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      setOverlayOpacity(0)
      setPlayerOpacity(0)
      let openRaf1 = 0
      let openRaf2 = 0
      openRaf1 = requestAnimationFrame(() => {
        openRaf2 = requestAnimationFrame(() => {
          setOverlayOpacity(1)
          setPlayerOpacity(1)
        })
      })
      return () => {
        if (openRaf1) cancelAnimationFrame(openRaf1)
        if (openRaf2) cancelAnimationFrame(openRaf2)
      }
    }
    if (!visible) {
      return
    }
    setOverlayOpacity(0)
    setPlayerOpacity(0)
    closeTimerRef.current = window.setTimeout(() => {
      setVisible(false)
    }, 500)
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [open, visible])

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

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [])

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
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget) setVisible(false)
      }}
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
