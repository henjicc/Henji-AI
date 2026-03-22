import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiIconButton } from '@/components/ui'
import {
  CloseIcon,
  VolumeMutedIcon,
  VolumeOnIcon,
} from './VideoViewerIcons'
import { VideoViewerControls } from './VideoViewerControls'

type VideoFrameRequestCallback = (now: number, metadata: { mediaTime: number }) => void
interface RenderedVideoRect {
  left: number
  top: number
  width: number
  height: number
}

export interface VideoViewerModalProps {
  open: boolean
  videoUrl: string
  filePath?: string
  onClose: () => void
  onDownload?: (filePath: string) => void
}

export function VideoViewerModal({ open, videoUrl, filePath, onClose, onDownload }: VideoViewerModalProps): JSX.Element | null {
  const { t } = useI18n()
  const [isVisible, setIsVisible] = useState(open)
  const [overlayOpacity, setOverlayOpacity] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoViewportRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const progressFillRef = useRef<HTMLDivElement>(null)
  const controlsContainerRef = useRef<HTMLDivElement>(null)
  const frameIntervalRef = useRef(1 / 30)
  const videoFrameCallbackIdRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const [viewerOpacity, setViewerOpacity] = useState(0)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [isControlsVisible, setIsControlsVisible] = useState(true)
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false)
  const [isVolumeMenuOpen, setIsVolumeMenuOpen] = useState(false)
  const [showVolumeIndicator, setShowVolumeIndicator] = useState(false)
  const [isDraggingProgress, setIsDraggingProgress] = useState(false)
  const [autoPlayOnOpen, setAutoPlayOnOpen] = useState(false)
  const [renderedVideoRect, setRenderedVideoRect] = useState<RenderedVideoRect>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  })
  const controlsHideTimer = useRef<number | null>(null)
  const volumeIndicatorTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!isVisible) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [isVisible])

  useEffect(() => {
    if (!open) return
    setIsVisible(true)
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setOverlayOpacity(0)
    setViewerOpacity(0)
    let openRaf1 = 0
    let openRaf2 = 0
    openRaf1 = requestAnimationFrame(() => {
      openRaf2 = requestAnimationFrame(() => {
        setOverlayOpacity(1)
        setViewerOpacity(1)
      })
    })
    setIsVideoPlaying(false)
    setCurrentTime(0)
    setVideoDuration(0)
    setIsBuffering(false)
    setIsControlsVisible(true)
    setIsSpeedMenuOpen(false)
    setIsVolumeMenuOpen(false)
    setIsDraggingProgress(false)
    setAutoPlayOnOpen(true)
    return () => {
      if (openRaf1) cancelAnimationFrame(openRaf1)
      if (openRaf2) cancelAnimationFrame(openRaf2)
    }
  }, [open, videoUrl])

  useEffect(() => {
    if (open) return
    if (!isVisible) return
    setOverlayOpacity(0)
    setViewerOpacity(0)
    closeTimerRef.current = window.setTimeout(() => {
      setIsVisible(false)
    }, 500)
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [open, isVisible])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === ' ') {
        e.preventDefault()
        if (videoRef.current) {
          if (isVideoPlaying) {
            videoRef.current.pause()
          } else {
            videoRef.current.play().catch(() => {})
          }
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const v = videoRef.current
        if (!v) return
        const step = (e.ctrlKey || e.metaKey) ? frameIntervalRef.current : 1
        const duration = Number.isFinite(v.duration) ? v.duration : 0
        const limit = duration > 0 ? duration : v.currentTime + step
        const next = e.key === 'ArrowLeft'
          ? Math.max(0, v.currentTime - step)
          : Math.min(limit, v.currentTime + step)
        v.currentTime = next
        setCurrentTime(next)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, isVideoPlaying])

  useEffect(() => {
    if (!open) return
    frameIntervalRef.current = 1 / 30
    const v = videoRef.current
    if (!v) return
    const requestFrame = (v as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number
      cancelVideoFrameCallback?: (handle: number) => void
    }).requestVideoFrameCallback
    const cancelFrame = (v as HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void
    }).cancelVideoFrameCallback

    if (!requestFrame) return

    let lastMediaTime = 0
    let frameCount = 0
    const estimateFrameRate: VideoFrameRequestCallback = (_, metadata) => {
      if (metadata.mediaTime > lastMediaTime) {
        frameCount += 1
        if (frameCount >= 5) {
          frameIntervalRef.current = (metadata.mediaTime - lastMediaTime) / frameCount
          frameCount = 0
          lastMediaTime = metadata.mediaTime
        }
      }
      if (open && videoRef.current) {
        videoFrameCallbackIdRef.current = requestFrame.call(v, estimateFrameRate)
      }
    }

    videoFrameCallbackIdRef.current = requestFrame.call(v, estimateFrameRate)

    return () => {
      if (cancelFrame && videoFrameCallbackIdRef.current !== null) {
        cancelFrame.call(v, videoFrameCallbackIdRef.current)
        videoFrameCallbackIdRef.current = null
      }
    }
  }, [open, videoUrl])

  useEffect(() => {
    if (!open) return
    if (!videoDuration) {
      if (progressFillRef.current) progressFillRef.current.style.width = '0%'
      return
    }
    const percent = Math.min(1, Math.max(0, currentTime / videoDuration))
    if (progressFillRef.current) progressFillRef.current.style.width = `${percent * 100}%`
  }, [currentTime, videoDuration, open])

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = loop
  }, [loop])

  const showVolumeHud = useCallback((): void => {
    setShowVolumeIndicator(true)
    if (volumeIndicatorTimer.current) {
      clearTimeout(volumeIndicatorTimer.current)
    }
    volumeIndicatorTimer.current = window.setTimeout(() => {
      setShowVolumeIndicator(false)
    }, 1000)
  }, [])

  const updateVolume = useCallback((next: number): void => {
    const clamped = Math.min(1, Math.max(0, next))
    setMuted(false)
    setVolume(clamped)
    showVolumeHud()
  }, [showVolumeHud])

  const updateRenderedVideoRect = useCallback((): void => {
    const viewport = videoViewportRef.current
    const video = videoRef.current
    if (!viewport) return

    const viewportWidth = viewport.clientWidth
    const viewportHeight = viewport.clientHeight
    if (viewportWidth <= 0 || viewportHeight <= 0) return

    const videoWidth = video?.videoWidth ?? 0
    const videoHeight = video?.videoHeight ?? 0

    if (videoWidth <= 0 || videoHeight <= 0) {
      setRenderedVideoRect({
        left: 0,
        top: 0,
        width: viewportWidth,
        height: viewportHeight,
      })
      return
    }

    const viewportAspect = viewportWidth / viewportHeight
    const videoAspect = videoWidth / videoHeight

    if (viewportAspect > videoAspect) {
      const renderedWidth = viewportHeight * videoAspect
      setRenderedVideoRect({
        left: (viewportWidth - renderedWidth) / 2,
        top: 0,
        width: renderedWidth,
        height: viewportHeight,
      })
      return
    }

    const renderedHeight = viewportWidth / videoAspect
    setRenderedVideoRect({
      left: 0,
      top: (viewportHeight - renderedHeight) / 2,
      width: viewportWidth,
      height: renderedHeight,
    })
  }, [])

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isVideoPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play().catch(() => {})
    }
  }

  const scheduleHideControls = useCallback((): void => {
    if (controlsHideTimer.current) {
      clearTimeout(controlsHideTimer.current)
      controlsHideTimer.current = null
    }
    if (isVideoPlaying && !isSpeedMenuOpen && !isVolumeMenuOpen) {
      controlsHideTimer.current = window.setTimeout(() => {
        if (!isSpeedMenuOpen && !isVolumeMenuOpen) {
          setIsControlsVisible(false)
        }
      }, 1500)
    }
  }, [isSpeedMenuOpen, isVideoPlaying, isVolumeMenuOpen])

  const handleProgressAt = useCallback((clientX: number): void => {
    const el = progressBarRef.current
    if (!el || !videoDuration) return
    const rect = el.getBoundingClientRect()
    const percent = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const t = percent * videoDuration
    setCurrentTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
    if (progressFillRef.current) progressFillRef.current.style.width = `${percent * 100}%`
  }, [videoDuration])

  const handleViewportClick = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    const viewport = videoViewportRef.current
    if (!viewport) return

    const rect = viewport.getBoundingClientRect()
    const relativeX = e.clientX - rect.left
    const relativeY = e.clientY - rect.top

    const isInsideRenderedVideo =
      relativeX >= renderedVideoRect.left &&
      relativeX <= renderedVideoRect.left + renderedVideoRect.width &&
      relativeY >= renderedVideoRect.top &&
      relativeY <= renderedVideoRect.top + renderedVideoRect.height

    if (!isInsideRenderedVideo) {
      onClose()
    }
  }, [onClose, renderedVideoRect])

  useEffect(() => {
    if (!isVisible) return
    updateRenderedVideoRect()
  }, [isVisible, videoUrl, updateRenderedVideoRect])

  useEffect(() => {
    if (!isVisible) return
    const viewport = videoViewportRef.current
    if (!viewport) return

    const observer = new ResizeObserver(() => {
      updateRenderedVideoRect()
    })
    observer.observe(viewport)

    const handleWindowResize = (): void => {
      updateRenderedVideoRect()
    }
    window.addEventListener('resize', handleWindowResize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [isVisible, updateRenderedVideoRect])

  const isOverlayControlsVisible = isSpeedMenuOpen || isVolumeMenuOpen || isControlsVisible

  if (!isVisible) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex items-center justify-center p-6"
      style={{
        opacity: overlayOpacity,
        transition: 'opacity 500ms ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative w-[92vw] h-[90vh] flex items-center justify-center"
        onMouseEnter={() => {
          setIsControlsVisible(true)
          scheduleHideControls()
        }}
        onMouseMove={() => {
          setIsControlsVisible(true)
          scheduleHideControls()
        }}
        onMouseLeave={() => {
          if (controlsHideTimer.current) {
            clearTimeout(controlsHideTimer.current)
            controlsHideTimer.current = null
          }
          if (!isSpeedMenuOpen && !isVolumeMenuOpen) {
            setIsControlsVisible(false)
          }
        }}
        style={{ cursor: isVideoPlaying && !isSpeedMenuOpen && !isControlsVisible ? 'none' : 'default' }}
      >
        <div
          ref={videoViewportRef}
          className="relative w-full h-full flex items-center justify-center"
          onClick={handleViewportClick}
        >
          <div
            className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm px-4 py-2 rounded-lg text-white z-10 flex items-center gap-2"
            style={{ opacity: showVolumeIndicator ? 1 : 0, transition: 'opacity 200ms ease', pointerEvents: 'none' }}
          >
            {muted || volume === 0 ? (
              <VolumeMutedIcon className="w-5 h-5" />
            ) : (
              <VolumeOnIcon className="w-5 h-5" />
            )}
            <span className="text-base font-medium">{Math.round((muted ? 0 : volume) * 100)}%</span>
          </div>

          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            style={{ opacity: viewerOpacity * overlayOpacity, transition: 'opacity 500ms ease' }}
            onLoadedMetadata={() => {
              if (videoRef.current) {
                setVideoDuration(videoRef.current.duration || 0)
                updateRenderedVideoRect()
                if (autoPlayOnOpen) {
                  videoRef.current.play().catch(() => {})
                  setAutoPlayOnOpen(false)
                }
              }
            }}
            onTimeUpdate={() => {
              if (videoRef.current) setCurrentTime(videoRef.current.currentTime || 0)
            }}
            onPlaying={() => {
              setIsBuffering(false)
              setIsVideoPlaying(true)
            }}
            onPause={() => setIsVideoPlaying(false)}
            onWaiting={() => setIsBuffering(true)}
            onStalled={() => setIsBuffering(true)}
            onClick={togglePlay}
            onWheel={(e) => {
              e.preventDefault()
              const delta = e.deltaY > 0 ? -0.05 : 0.05
              updateVolume((muted ? 0 : volume) + delta)
            }}
            controls={false}
          />
          <div
            className="absolute z-10 pointer-events-none"
            style={{
              left: renderedVideoRect.left,
              top: renderedVideoRect.top,
              width: renderedVideoRect.width,
              height: renderedVideoRect.height,
              opacity: isOverlayControlsVisible ? 1 : 0,
              transition: 'opacity 500ms ease',
            }}
          >
            <UiIconButton
              onClick={onClose}
              className="absolute top-2 right-2 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700/80 pointer-events-auto"
              title={t('common:close')}
            >
              <CloseIcon />
            </UiIconButton>
          </div>
        </div>

        <VideoViewerControls
          controlsContainerRef={controlsContainerRef}
          progressBarRef={progressBarRef}
          progressFillRef={progressFillRef}
          isControlsVisible={isControlsVisible}
          isSpeedMenuOpen={isSpeedMenuOpen}
          setIsSpeedMenuOpen={setIsSpeedMenuOpen}
          isVolumeMenuOpen={isVolumeMenuOpen}
          setIsVolumeMenuOpen={setIsVolumeMenuOpen}
          isDraggingProgress={isDraggingProgress}
          setIsDraggingProgress={setIsDraggingProgress}
          handleProgressAt={handleProgressAt}
          isVideoPlaying={isVideoPlaying}
          togglePlay={togglePlay}
          currentTime={currentTime}
          videoDuration={videoDuration}
          muted={muted}
          volume={volume}
          setMuted={setMuted}
          updateVolume={updateVolume}
          playbackRate={playbackRate}
          setPlaybackRate={setPlaybackRate}
          loop={loop}
          setLoop={setLoop}
          onDownload={onDownload}
          filePath={filePath}
          isBuffering={isBuffering}
        />
      </div>
    </div>
  )
}
