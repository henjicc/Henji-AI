import React, { useMemo } from 'react'
import { toDisplaySrc } from '@/platform/desktopApi'
import AudioPlayer from '@/components/AudioPlayer'
import { UiViewerShell, useUiViewerShell } from '@/components/ui';
import { UI_DURATION, uiTransition } from '@/components/ui/motion'

export interface AudioViewerModalProps {
  open: boolean
  audioUrl: string
  filePath?: string
  onClose: () => void
  autoPlay?: boolean
}

export function AudioViewerModal({ open, audioUrl, filePath, onClose, autoPlay = false }: AudioViewerModalProps): JSX.Element | null {
  const viewer = useUiViewerShell(open, onClose)
  const isVisible = viewer.shouldRender
  const overlayOpacity = viewer.opacity
  const playerOpacity = overlayOpacity
  const playbackUrl = useMemo(() => {
    const normalizedPath = filePath?.trim()
    if (normalizedPath) {
      return toDisplaySrc(normalizedPath.replace(/\\/g, '/'))
    }
    return audioUrl
  }, [audioUrl, filePath])


  if (!isVisible) return null

  return (
    <UiViewerShell viewer={viewer} presentation="centered" aria-label="音频">
      <div
        style={{
          opacity: playerOpacity * overlayOpacity,
          transform: `scale(${0.98 + 0.02 * playerOpacity})`,
          transition: uiTransition(['opacity', 'transform'], UI_DURATION.viewer),
        }}
      >
        <AudioPlayer src={playbackUrl} filePath={filePath} autoPlay={autoPlay} active={open} compact className="!w-[44rem] !max-w-[92vw]" />
      </div>
    </UiViewerShell>
  )
}
