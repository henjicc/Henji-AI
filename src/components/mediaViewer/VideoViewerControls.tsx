import React from 'react'
import { Dropdown, UI_TEXT_TIMECODE_CLASS, UiIconButton, UiPanel, UiRangeInput } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { UI_DURATION, uiTransition } from '@/components/ui/motion'
import { Download, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react'

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => ({ label: `${speed}x`, value: speed }))

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
  setIsSpeedMenuOpen: (open: boolean) => void
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

/**
 * 视频查看器控制条（任务 5.9 收敛）：整条是压在画面上的玻璃面板（`UiPanel variant="glass"`，随主题派生，
 * 纸白下是浅色玻璃），因此条内文字、轨道与按钮一律用主题令牌，不再混用固定白字的媒体叠层令牌——
 * 原先的私有 CSS（progress / speed / volume 共 16 个类）在浅色玻璃上读不清（4.2 转交）。
 * 倍速是共享 `Dropdown`（玻璃菜单，选中淡强调底 + 勾、浮层归属、键盘），音量是常驻的 `UiRangeInput`。
 */
export function VideoViewerControls({
  controlsContainerRef,
  progressBarRef,
  progressFillRef,
  isControlsVisible,
  isSpeedMenuOpen,
  setIsSpeedMenuOpen,
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
  const visible = isSpeedMenuOpen || isControlsVisible
  const effectiveVolume = muted ? 0 : volume

  return (
    <div
      ref={controlsContainerRef}
      className="absolute inset-x-4 bottom-4 z-sticky mx-auto max-w-3xl"
      style={{
        opacity: visible ? 1 : 0,
        transition: uiTransition(['opacity'], UI_DURATION.viewer),
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* 控件条直接压在用户的视频画面上，走玻璃材质；毛玻璃开关关掉时自动退化成面板实底。 */}
      <UiPanel variant="glass" className="flex flex-col gap-3 px-4 py-3">
        {/* 命中区比可见轨道高，便于点按与拖动；轨道几何（播放进度、裁剪区间）是随时间变化的动态值 */}
        <div
          ref={progressBarRef}
          data-video-progress
          className="group/progress cursor-pointer py-1.5"
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
          <div className="relative h-1.5 rounded-full bg-text1/15">
            <div ref={progressFillRef} className="relative h-full w-0 rounded-full bg-accent">
              <span
                aria-hidden="true"
                className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-accent opacity-0 transition-opacity duration-180 group-hover/progress:opacity-100"
              />
            </div>
            {trimRange && videoDuration > 0 && (
              <div
                data-video-trim-range
                className="pointer-events-none absolute inset-y-0 rounded-full bg-text1/30"
                style={{
                  left: `${(trimRange.start / videoDuration) * 100}%`,
                  width: `${((trimRange.end - trimRange.start) / videoDuration) * 100}%`,
                }}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <UiIconButton size="xl" shape="circle" onClick={togglePlay} title={t('ui:audioPlayer.playPause')}>
            {isVideoPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </UiIconButton>
          <div className={`text-13 text-text1 ${UI_TEXT_TIMECODE_CLASS}`}>
            {formatTime(currentTime)} / {formatTime(videoDuration)}
          </div>
          {isBuffering && (
            <div className="text-xs text-text2">{t('ui:workspace.status.buffering')}</div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {hasAudio !== false && (
              <div
                className="flex items-center gap-1"
                onWheel={(e) => {
                  e.preventDefault()
                  const delta = e.deltaY > 0 ? -0.05 : 0.05
                  updateVolume(effectiveVolume + delta)
                }}
              >
                <UiIconButton
                  size="lg"
                  onClick={() => setMuted((value) => !value)}
                  title={muted ? t('ui:viewer.unmute') : t('ui:viewer.mute')}
                >
                  {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </UiIconButton>
                <UiRangeInput
                  aria-label={t('ui:viewer.volume')}
                  className="w-20"
                  min={0}
                  max={1}
                  step={0.01}
                  value={effectiveVolume}
                  onChange={(event) => updateVolume(Number(event.target.value))}
                />
              </div>
            )}

            <Dropdown
              ariaLabel={t('ui:viewer.speed')}
              value={playbackRate}
              options={SPEED_OPTIONS}
              onSelect={setPlaybackRate}
              onOpenChange={setIsSpeedMenuOpen}
              appearance="text"
              size="sm"
              surface="glass"
              minWidthStrategy="display"
              panelWidthStrategy="options"
              buttonClassName="w-auto"
            />

            <UiIconButton size="lg"
              on={loop}
              aria-pressed={loop}
              onClick={() => setLoop((value) => !value)}
              title={t('ui:viewer.loop')}
            >
              <Repeat className="h-5 w-5" />
            </UiIconButton>
            {onDownload && filePath && (
              <UiIconButton size="lg"
                onClick={() => onDownload(filePath)}
                title={t('common:actions.download')}
              >
                <Download className="h-5 w-5" />
              </UiIconButton>
            )}
          </div>
        </div>
      </UiPanel>
    </div>
  )
}
