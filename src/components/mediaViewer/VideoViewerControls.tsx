import React from 'react'
import { UiIconButton } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import {
  DownloadIcon,
  LoopIcon,
  PauseIcon,
  PlayIcon,
  VolumeMutedIcon,
  VolumeOnIcon,
} from './VideoViewerIcons'

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

interface VideoViewerControlsProps {
  controlsContainerRef: React.RefObject<HTMLDivElement>
  progressBarRef: React.RefObject<HTMLDivElement>
  progressFillRef: React.RefObject<HTMLDivElement>
  isControlsVisible: boolean
  isSpeedMenuOpen: boolean
  setIsSpeedMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  isVolumeMenuOpen: boolean
  setIsVolumeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  isDraggingProgress: boolean
  setIsDraggingProgress: React.Dispatch<React.SetStateAction<boolean>>
  handleProgressAt: (clientX: number) => void
  isVideoPlaying: boolean
  togglePlay: () => void
  currentTime: number
  videoDuration: number
  muted: boolean
  volume: number
  hasAudio: boolean | null
  setMuted: React.Dispatch<React.SetStateAction<boolean>>
  updateVolume: (next: number) => void
  playbackRate: number
  setPlaybackRate: React.Dispatch<React.SetStateAction<number>>
  loop: boolean
  setLoop: React.Dispatch<React.SetStateAction<boolean>>
  onDownload?: (filePath: string) => void
  filePath?: string
  isBuffering: boolean
  /** 若有保存过的裁剪选区，在进度条上高亮标出对应区间，帮助用户理解播放为何在某点跳回 */
  trimRange?: { start: number; end: number }
}

export function VideoViewerControls({
  controlsContainerRef,
  progressBarRef,
  progressFillRef,
  isControlsVisible,
  isSpeedMenuOpen,
  setIsSpeedMenuOpen,
  isVolumeMenuOpen,
  setIsVolumeMenuOpen,
  isDraggingProgress,
  setIsDraggingProgress,
  handleProgressAt,
  isVideoPlaying,
  togglePlay,
  currentTime,
  videoDuration,
  muted,
  volume,
  hasAudio,
  setMuted,
  updateVolume,
  playbackRate,
  setPlaybackRate,
  loop,
  setLoop,
  onDownload,
  filePath,
  isBuffering,
  trimRange,
}: VideoViewerControlsProps): JSX.Element {
  const { t } = useI18n()

  return (
    <div
      ref={controlsContainerRef}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[90%] max-w-3xl"
      style={{
        opacity: isSpeedMenuOpen || isVolumeMenuOpen || isControlsVisible ? 1 : 0,
        transition: 'opacity 500ms ease',
        pointerEvents: isSpeedMenuOpen || isVolumeMenuOpen || isControlsVisible ? 'auto' : 'none',
      }}
    >
      <div className="bg-panel/90 border border-zinc-700/50 rounded-xl px-4 py-3 text-white flex flex-col gap-3">
        <div
          ref={progressBarRef}
          className="progress-container"
          onMouseDown={(e) => {
            e.preventDefault()
            setIsDraggingProgress(true)
            handleProgressAt(e.clientX)
          }}
          onMouseMove={(e) => {
            if (!isDraggingProgress) return
            handleProgressAt(e.clientX)
          }}
          onMouseUp={() => setIsDraggingProgress(false)}
          onMouseLeave={() => setIsDraggingProgress(false)}
        >
          <div ref={progressFillRef} className="progress-bar" />
          {trimRange && videoDuration > 0 && (
            <div
              className="absolute inset-y-0 pointer-events-none rounded-sm"
              style={{
                left: `${(trimRange.start / videoDuration) * 100}%`,
                width: `${((trimRange.end - trimRange.start) / videoDuration) * 100}%`,
                background: 'rgba(var(--text-rgb),0.25)',
              }}
            />
          )}
        </div>

        <div className="controls-main">
          <UiIconButton onClick={togglePlay} className="btn btn-play !h-auto !w-auto !border-0 !bg-transparent" title={t('ui:audioPlayer.playPause')}>
            {isVideoPlaying ? <PauseIcon /> : <PlayIcon />}
          </UiIconButton>
          <div className="time-display">{formatTime(currentTime)} / {formatTime(videoDuration)}</div>
          <div className="controls-right">
            {hasAudio !== false && (
              <div
                className="speed-control"
                onMouseEnter={() => setIsVolumeMenuOpen(true)}
                onMouseLeave={() => setIsVolumeMenuOpen(false)}
              >
                <div
                  className="speed-display"
                  onClick={() => setMuted((value) => !value)}
                  title={muted ? t('ui:viewer.unmute') : t('ui:viewer.mute')}
                >
                  {muted || volume === 0 ? <VolumeMutedIcon className="w-5 h-5" /> : <VolumeOnIcon className="w-5 h-5" />}
                </div>
                <div
                  className={`speed-menu volume-menu ${isVolumeMenuOpen ? 'active' : ''}`}
                  onWheel={(e) => {
                    e.preventDefault()
                    const delta = e.deltaY > 0 ? -0.05 : 0.05
                    updateVolume((muted ? 0 : volume) + delta)
                  }}
                >
                  <div className="volume-vertical">
                    <div className="volume-percent">{Math.round((muted ? 0 : volume) * 100)}</div>
                    <div
                      className="volume-track"
                      onClick={(e) => {
                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                        const percent = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
                        updateVolume(percent)
                      }}
                    >
                      <div className="volume-fill" style={{ height: `calc(5px + (100% - 10px) * ${muted ? 0 : volume})` }} />
                      <div className="volume-thumb" style={{ bottom: `calc(5px + (100% - 10px) * ${muted ? 0 : volume})` }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div
              className="speed-control"
              onMouseEnter={() => setIsSpeedMenuOpen(true)}
              onMouseLeave={() => setIsSpeedMenuOpen(false)}
            >
              <div className="speed-display" title={t('ui:viewer.speed')}>{playbackRate}x</div>
              <div className={`speed-menu ${isSpeedMenuOpen ? 'active' : ''}`}>
                {SPEED_OPTIONS.map((speed) => (
                  <div
                    key={speed}
                    className={`speed-option ${playbackRate === speed ? 'active' : ''}`}
                    onClick={() => {
                      setPlaybackRate(speed)
                      setIsSpeedMenuOpen(false)
                    }}
                  >
                    {speed}x
                  </div>
                ))}
              </div>
            </div>

            <UiIconButton
              className={`btn btn-small !h-auto !w-auto !border-0 !bg-transparent ${loop ? 'loop-active' : ''}`}
              onClick={() => setLoop((value) => !value)}
              title={t('ui:viewer.loop')}
            >
              <LoopIcon />
            </UiIconButton>
            {onDownload && filePath && (
              <UiIconButton
                className="btn btn-small !h-auto !w-auto !border-0 !bg-transparent"
                onClick={() => onDownload(filePath)}
                title={t('common:actions.download')}
              >
                <DownloadIcon />
              </UiIconButton>
            )}
          </div>
        </div>
      </div>
      {isBuffering && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-zinc-300">
          {t('ui:workspace.status.buffering')}
        </div>
      )}
    </div>
  )
}
