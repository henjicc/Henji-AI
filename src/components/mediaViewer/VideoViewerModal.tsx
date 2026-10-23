import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNonPassiveWheel } from '@/hooks/useNonPassiveWheel'
import { createPortal } from 'react-dom'
import { useI18n } from '@/hooks/useI18n'
import { UiError, UiIconButton } from '@/components/ui'
import { createLogger } from '@/core/logging'
import { readVideoInfo } from '@/commands/video'
import { Volume2, VolumeX, X } from 'lucide-react'
import { VideoViewerControls } from './VideoViewerControls'
import { useVideoAutoGain } from './useVideoAutoGain'
import { useVideoViewerTimeline, type VideoViewerTimeline, type VideoViewerSeek } from './useVideoViewerTimeline'
import { UiViewerShell, useUiViewerShell } from '@/components/ui';
import { UI_DURATION, uiTransition } from '@/components/ui/motion'

const logger = createLogger('components.mediaViewer.VideoViewerModal')

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
  /** 若视频有关联的裁剪选区，自动从 start 开始播放并在 end 处跳回——
   *  进度条仍显示完整时长，满足"看起来是完整视频，但只播放选中段"的体验要求 */
  trimRange?: { start: number; end: number }
  /** Inline hosts reuse the same playback and controls without claiming a modal layer. */
  presentation?: 'modal' | 'inline'
  timeline?: VideoViewerTimeline
  seekRequest?: VideoViewerSeek
  mediaTestId?: string
}

export function VideoViewerModal({ open, videoUrl, filePath, onClose, onDownload, trimRange, presentation = 'modal', timeline, seekRequest, mediaTestId }: VideoViewerModalProps): JSX.Element | null {
  const { t } = useI18n()
  const inline = presentation === 'inline'
  const viewer = useUiViewerShell(open && !inline, onClose, { enterKey: videoUrl })
  const isVisible = inline ? open : viewer.shouldRender
  const overlayOpacity = inline ? 1 : viewer.opacity
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoViewportRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const progressFillRef = useRef<HTMLDivElement>(null)
  const controlsContainerRef = useRef<HTMLDivElement>(null)
  const frameIntervalRef = useRef(1 / 30)
  const videoFrameCallbackIdRef = useRef<number | null>(null)

  const viewerOpacity = overlayOpacity
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [hasAudio, setHasAudio] = useState<boolean | null>(null)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  // 视频文件被移动或删除时不留空黑画面与一直转圈的缓冲，显示可理解的失败提示（任务 5.8，与图片查看器同源）
  const [failedVideo, setFailedVideo] = useState<string | null>(null)
  const [isControlsVisible, setIsControlsVisible] = useState(true)
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false)
  const [showVolumeIndicator, setShowVolumeIndicator] = useState(false)
  const [isDraggingProgress, setIsDraggingProgress] = useState(false)
  const [autoPlayOnOpen, setAutoPlayOnOpen] = useState(false)
  const [renderedVideoRect, setRenderedVideoRect] = useState<RenderedVideoRect>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  })
  const timelinePlayer = useVideoViewerTimeline(timeline, videoRef, open, playbackRate, loop, seekRequest)
  const sourceUrl = timelinePlayer.segment?.videoUrl ?? videoUrl
  const sourcePath = timelinePlayer.segment?.filePath ?? filePath
  const videoFailed = Boolean(sourceUrl) && failedVideo === sourceUrl
  const displayedTime = timeline ? timelinePlayer.currentTime : currentTime
  const displayedDuration = timeline?.duration ?? videoDuration
  const displayedPlaying = timeline ? timelinePlayer.playing : isVideoPlaying
  const controlsHideTimer = useRef<number | null>(null)
  const autoGain = useVideoAutoGain(videoRef, sourceUrl, t('ui:viewer.autoGainUnavailable'))
  const contentRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const changed = (): void => setIsFullscreen(document.fullscreenElement !== null && document.fullscreenElement === contentRef.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  const toggleFullscreen = useCallback((): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void contentRef.current?.requestFullscreen().catch(() => undefined)
  }, [])
  const volumeIndicatorTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setIsVideoPlaying(false)
    setCurrentTime(0)
    setVideoDuration(0)
    setMuted(false)
    setPlaybackRate(1)
    setLoop(false)
    setIsBuffering(false)
    setIsControlsVisible(true)
    setIsSpeedMenuOpen(false)
    setIsDraggingProgress(false)
    setAutoPlayOnOpen(true)
  }, [open, videoUrl])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setHasAudio(null)
    void readVideoInfo(sourcePath ?? sourceUrl).then(
      (info) => {
        if (cancelled) return
        setHasAudio(info.hasAudio)
      },
      () => {
        if (!cancelled) setHasAudio(null)
      },
    )
    return () => { cancelled = true }
  }, [sourcePath, open, sourceUrl])

  useEffect(() => {
    if (open) return
    if (!isVisible) return
    videoRef.current?.pause()
    setIsVideoPlaying(false)
    setAutoPlayOnOpen(false)
  }, [open, isVisible])

  useEffect(() => {
    if (!open || inline) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable=true], button'))) return
      if (timeline) {
        if (e.key === ' ') { e.preventDefault(); timelinePlayer.togglePlay() }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); timelinePlayer.seek(displayedTime + (e.key === 'ArrowLeft' ? -1 : 1)) }
        return
      }
      if (e.key === ' ') {
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
  }, [open, inline, isVideoPlaying, timeline, timelinePlayer, displayedTime])

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
    if (!displayedDuration) {
      if (progressFillRef.current) progressFillRef.current.style.width = '0%'
      return
    }
    const percent = Math.min(1, Math.max(0, displayedTime / displayedDuration))
    if (progressFillRef.current) progressFillRef.current.style.width = `${percent * 100}%`
  }, [displayedTime, displayedDuration, open])

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume
  }, [volume, isVisible, sourceUrl])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, isVisible, sourceUrl])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate, isVisible, sourceUrl])

  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = timeline ? false : loop
  }, [loop, isVisible, sourceUrl, timeline])

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
    if (timeline) { timelinePlayer.togglePlay(); return }
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
    if (isVideoPlaying && !isSpeedMenuOpen) {
      controlsHideTimer.current = window.setTimeout(() => {
        if (!isSpeedMenuOpen) {
          setIsControlsVisible(false)
        }
      }, 1500)
    }
  }, [isSpeedMenuOpen, isVideoPlaying])

  const handleProgressAt = useCallback((clientX: number): void => {
    const el = progressBarRef.current
    if (!el || !displayedDuration) return
    const rect = el.getBoundingClientRect()
    const percent = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const t = percent * displayedDuration
    if (timeline) { timelinePlayer.seek(t); return }
    setCurrentTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
    if (progressFillRef.current) progressFillRef.current.style.width = `${percent * 100}%`
  }, [displayedDuration, timeline, timelinePlayer])

  const handleViewportClick = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    if (inline) return
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
  }, [inline, onClose, renderedVideoRect])

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

  // Inline hosts hide the controls the same way: when the pointer leaves or rests during playback.
  const isOverlayControlsVisible = isSpeedMenuOpen || isControlsVisible

  // 画面上滚轮调音量并拦住页面滚动：React onWheel 是被动的，走非被动原生监听
  useNonPassiveWheel(videoRef, (e) => {
    if (hasAudio === false) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    updateVolume((muted ? 0 : volume) + delta)
  }, isVisible)

  if (!isVisible) return null

  const content = <div
        ref={contentRef}
        className={inline ? "relative isolate aspect-video w-full bg-media flex items-center justify-center" : "relative isolate w-[92vw] h-[90vh] flex items-center justify-center"}
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
          // A short grace period so the controls don't vanish the instant the pointer slips out.
          if (!isSpeedMenuOpen) {
            controlsHideTimer.current = window.setTimeout(() => setIsControlsVisible(false), 600)
          }
        }}
        style={{ cursor: isVideoPlaying && !isSpeedMenuOpen && !isControlsVisible ? 'none' : 'default' }}
      >
        <div
          ref={videoViewportRef}
          className="relative w-full h-full flex items-center justify-center"
          onClick={handleViewportClick}
        >
          {hasAudio !== false && (
            <div
              className="ui-glass absolute top-4 left-4 px-4 py-2 rounded-lg text-text1 z-raised flex items-center gap-2"
              style={{ opacity: showVolumeIndicator ? 1 : 0, transition: uiTransition(['opacity'], UI_DURATION.base), pointerEvents: 'none' }}
            >
              {muted || volume === 0 ? (
                <VolumeX className={`${UI_ICON_SIZE_CLASS.lg}`} />
              ) : (
                <Volume2 className={`${UI_ICON_SIZE_CLASS.lg}`} />
              )}
              <span className="text-base font-medium">{Math.round((muted ? 0 : volume) * 100)}%</span>
            </div>
          )}

          <video
            ref={videoRef}
            src={sourceUrl}
            crossOrigin={autoGain.crossOrigin}
            data-testid={mediaTestId}
            data-viewer-time={timeline ? displayedTime : undefined}
            data-viewer-duration={timeline?.duration}
            data-viewer-gap={timelinePlayer.gap || undefined}
            preload="auto"
            playsInline
            className={`w-full h-full object-contain ${timeline && timelinePlayer.gap ? "invisible" : ""}`}
            style={{ opacity: viewerOpacity * overlayOpacity, transition: uiTransition(['opacity'], UI_DURATION.viewer) }}
            onLoadedMetadata={() => {
              autoGain.loaded()
              if (timeline) { timelinePlayer.loaded(); updateRenderedVideoRect(); return }
              if (videoRef.current) {
                setVideoDuration(videoRef.current.duration || 0)
                updateRenderedVideoRect()
                if (autoPlayOnOpen) {
                  // 有裁剪选区时从 start 处开始播放，而不是从 0——
                  // 但 videoDuration 仍用完整时长，进度条不做范围内重新归一化
                  if (trimRange && trimRange.start > 0) {
                    videoRef.current.currentTime = trimRange.start
                  }
                  videoRef.current.play().catch(() => {})
                  setAutoPlayOnOpen(false)
                }
              }
            }}
            onTimeUpdate={() => {
              if (timeline) return
              const v = videoRef.current
              if (!v) return
              setCurrentTime(v.currentTime || 0)
              // 有裁剪选区时：超出 end 自动暂停并跳回 start——和 VideoTrimModal 里已有的
              // "预览只在选区内播放"逻辑一致，让用户在历史记录里也只看到选中的这段
              if (trimRange && v.currentTime >= trimRange.end) {
                v.pause()
                v.currentTime = trimRange.start
              }
            }}
            onEnded={() => { if (timeline) timelinePlayer.ended() }}
            onPlaying={() => {
              autoGain.playing()
              if (timeline) { timelinePlayer.setBuffering(false); return }
              setIsBuffering(false)
              setIsVideoPlaying(true)
            }}
            onPause={() => { if (!timeline) setIsVideoPlaying(false) }}
            onWaiting={() => { if (timeline) timelinePlayer.setBuffering(true); else setIsBuffering(true) }}
            onStalled={() => { if (timeline) timelinePlayer.setBuffering(true); else setIsBuffering(true) }}
            onError={() => {
              if (autoGain.failed()) return
              logger.warn('video_viewer.load_failed', { reason: 'video_load_failed' })
              setIsBuffering(false)
              timelinePlayer.failed()
              setFailedVideo(sourceUrl)
            }}
            onClick={togglePlay}
            controls={false}
          />
          {videoFailed && (
            <div className="pointer-events-none absolute inset-0 z-raised flex items-center justify-center">
              {/* 查看器是固定深色媒体底，提示放进随主题的实底面板：文字色与底同源；玻璃在纸白下透出深底，危险色标题只有 4.29:1 */}
              <div className="rounded-lg bg-panel px-6 shadow-panel">
                <UiError size="sm" title={t('ui:viewer.videoUnavailableTitle')} message={t('ui:viewer.imageUnavailableMessage')} />
              </div>
            </div>
          )}
          {!inline && <div
            className="absolute z-raised pointer-events-none"
            style={{
              left: renderedVideoRect.left,
              top: renderedVideoRect.top,
              width: renderedVideoRect.width,
              height: renderedVideoRect.height,
              opacity: isOverlayControlsVisible ? 1 : 0,
              transition: uiTransition(['opacity'], UI_DURATION.viewer),
            }}
          >
            <UiIconButton shape="circle" size="md" tone="media"
              onClick={onClose}
              className="absolute top-2 right-2 pointer-events-auto"
              tooltip={t('common:close')}
            >
              <X  />
            </UiIconButton>
          </div>}
        </div>
        <VideoViewerControls
          controlsContainerRef={controlsContainerRef}
          progressBarRef={progressBarRef}
          progressFillRef={progressFillRef}
          isControlsVisible={isOverlayControlsVisible}
          isSpeedMenuOpen={isSpeedMenuOpen}
          setIsSpeedMenuOpen={setIsSpeedMenuOpen}
          isDraggingProgress={isDraggingProgress}
          setIsDraggingProgress={setIsDraggingProgress}
          handleProgressAt={handleProgressAt}
          isVideoPlaying={displayedPlaying}
          togglePlay={togglePlay}
          currentTime={displayedTime}
          videoDuration={displayedDuration}
          muted={muted}
          volume={volume}
          hasAudio={hasAudio}
          setMuted={setMuted}
          updateVolume={updateVolume}
          playbackRate={playbackRate}
          setPlaybackRate={setPlaybackRate}
          loop={loop}
          setLoop={setLoop}
          autoGain={autoGain.enabled}
          autoGainUnavailable={autoGain.unavailable}
          onAutoGainChange={autoGain.setEnabled}
          fullscreen={inline ? { active: isFullscreen, toggle: toggleFullscreen } : undefined}
          onDownload={onDownload}
          filePath={filePath}
          isBuffering={timeline ? timelinePlayer.buffering : isBuffering}
          trimRange={trimRange}
        />
      </div>
  return inline ? content : createPortal(<UiViewerShell viewer={viewer} presentation="centered" aria-label={t('viewer.videoAlt', '视频')}>{content}</UiViewerShell>, document.body)
}
