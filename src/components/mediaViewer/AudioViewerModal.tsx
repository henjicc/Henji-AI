import React, { useEffect, useMemo, useRef, useState } from 'react'
import { toDisplaySrc } from '@/platform/desktopApi'
import AudioPlayer from '@/components/AudioPlayer'

export interface AudioViewerModalProps {
  open: boolean
  audioUrl: string
  filePath?: string
  onClose: () => void
  autoPlay?: boolean
}

export function AudioViewerModal({ open, audioUrl, filePath, onClose, autoPlay = false }: AudioViewerModalProps): JSX.Element | null {
  const [visible, setVisible] = useState(open)
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
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

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
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-6 backdrop-blur-lg"
      style={{
        opacity: overlayOpacity,
        transition: 'opacity 500ms ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        style={{
          opacity: playerOpacity * overlayOpacity,
          transform: `scale(${0.98 + 0.02 * playerOpacity})`,
          transition: 'opacity 500ms ease, transform 500ms ease',
        }}
      >
        <AudioPlayer src={playbackUrl} filePath={filePath} autoPlay={autoPlay} active={open} compact className="!w-[44rem] !max-w-[92vw]" />
      </div>
    </div>
  )
}
