import React, { useRef, useState } from 'react'
import { useNonPassiveWheel } from '@/hooks/useNonPassiveWheel'
import { Dropdown, UI_TEXT_TIMECODE_CLASS, UiIconButton, UiPanel } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { UI_DURATION, uiTransition } from '@/components/ui/motion'
import { Download, Maximize, Minimize, Pause, Play, Repeat, Volume1, Volume2, VolumeX, Waves } from 'lucide-react'

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => ({ label: `${speed}×`, value: speed }))

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
  /** 播放时把小声处提上来、大声处压住；不改文件。`autoGainUnavailable` 是不能处理这段声音时的原因。 */
  autoGain: boolean
  autoGainUnavailable?: string
  onAutoGainChange: (enabled: boolean) => void
  /** 只有嵌在页面里的查看器提供全屏；弹窗本身已占满窗口。 */
  fullscreen?: { active: boolean; toggle: () => void }
  onDownload?: (filePath: string) => void
  filePath?: string
  isBuffering: boolean
  /** 若有保存过的裁剪选区，在进度条上高亮标出对应区间，帮助用户理解播放为何在某点跳回 */
  trimRange?: { start: number; end: number }
}

/** 竖向音量条：悬停音量键时向上弹出，拖动、滚轮、方向键都能调。 */
function VolumePopover({ value, onChange, label }: { value: number; onChange: (next: number) => void; label: string }): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const setAt = (clientY: number): void => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onChange(Math.min(1, Math.max(0, (rect.bottom - clientY) / rect.height)))
  }
  return (
    <div className="ui-glass flex flex-col items-center gap-2 rounded-lg px-2 pb-3 pt-2">
      <span className={`text-xs text-text1 ${UI_TEXT_TIMECODE_CLASS}`}>{Math.round(value * 100)}</span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        className="relative h-24 w-4 cursor-pointer focus-visible:outline-none"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setAt(e.clientY) }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setAt(e.clientY) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); onChange(Math.min(1, value + 0.05)) }
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); onChange(Math.max(0, value - 0.05)) }
        }}
      >
        {/* 音量随拖动连续变化，轨道填充高度与圆点位置是动态值 */}
        <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-text1/20">
          <div className="absolute inset-x-0 bottom-0 rounded-full bg-accent" style={{ height: `${value * 100}%` }} />
        </div>
        <span aria-hidden="true" className="absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-text1 shadow-thumb-sm" style={{ bottom: `${value * 100}%` }} />
      </div>
    </div>
  )
}

/**
 * 视频查看器控制条：压在画面底部的双层玻璃胶囊——上层进度、下层按钮。进度条平时细、悬停变粗并提示时间；
 * 音量悬停向上弹出竖条；倍速、循环、自动增益与全屏常驻在按钮行。鼠标离开画面或播放中静止后由宿主隐藏。
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
  autoGain,
  autoGainUnavailable,
  onAutoGainChange,
  fullscreen,
  onDownload,
  filePath,
  isBuffering,
  trimRange,
}: VideoViewerControlsProps): JSX.Element {
  const { t } = useI18n()
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [hover, setHover] = useState<{ ratio: number } | null>(null)
  const closeVolume = useRef<number | null>(null)
  const visible = isSpeedMenuOpen || volumeOpen || isControlsVisible
  const effectiveVolume = muted ? 0 : volume
  const volumeRef = useRef<HTMLDivElement>(null)
  // 滚轮调音量并拦住页面滚动：React onWheel 是被动的，走非被动原生监听
  useNonPassiveWheel(volumeRef, (e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    updateVolume(effectiveVolume + delta)
  }, hasAudio)
  const showVolume = (): void => {
    if (closeVolume.current) window.clearTimeout(closeVolume.current)
    setVolumeOpen(true)
  }
  const hideVolume = (): void => {
    if (closeVolume.current) window.clearTimeout(closeVolume.current)
    closeVolume.current = window.setTimeout(() => setVolumeOpen(false), 200)
  }
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      ref={controlsContainerRef}
      className="absolute inset-x-4 bottom-3 z-sticky mx-auto max-w-xl"
      style={{
        opacity: visible ? 1 : 0,
        transition: uiTransition(['opacity'], UI_DURATION.viewer),
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* 胶囊直接压在用户的视频画面上，走玻璃材质；毛玻璃开关关掉时自动退化成面板实底。 */}
      <UiPanel variant="glass" className="flex flex-col gap-1 px-3 pb-1.5 pt-2">
        {/* 命中区比可见轨道高，便于点按与拖动；轨道几何（播放进度、裁剪区间、悬停位置）是随时间变化的动态值 */}
        <div
          ref={progressBarRef}
          data-video-progress
          className="group/progress relative cursor-pointer py-1.5"
          onMouseDown={(e) => {
            e.preventDefault()
            setIsDraggingProgress(true)
            handleProgressAt(e.clientX)
          }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setHover({ ratio: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) })
            if (!isDraggingProgress) return
            handleProgressAt(e.clientX)
          }}
          onMouseUp={() => setIsDraggingProgress(false)}
          onMouseLeave={() => { setIsDraggingProgress(false); setHover(null) }}
        >
          {hover && videoDuration > 0 && (
            <span
              className={`ui-glass pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-xs text-text1 ${UI_TEXT_TIMECODE_CLASS}`}
              style={{ left: `${hover.ratio * 100}%` }}
            >
              {formatTime(hover.ratio * videoDuration)}
            </span>
          )}
          <div className="relative h-1 rounded-full bg-text1/20 transition-[height] duration-120 group-hover/progress:h-1.5">
            <div ref={progressFillRef} className="relative h-full w-0 rounded-full bg-accent">
              <span
                aria-hidden="true"
                className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-text1 opacity-0 shadow-thumb-sm transition-opacity duration-180 group-hover/progress:opacity-100"
              />
            </div>
            {trimRange && videoDuration > 0 && (
              <div
                data-video-trim-range
                // text1 对轨道、on-accent 对已播放进度：双色实线留出对比余量，不是可拖手柄。
                className="pointer-events-none absolute inset-y-0 rounded-full bg-text1/65"
                style={{
                  left: `${(trimRange.start / videoDuration) * 100}%`,
                  width: `${((trimRange.end - trimRange.start) / videoDuration) * 100}%`,
                }}
              >
                <span aria-hidden="true" data-video-trim-boundary="start" className="absolute inset-y-0 left-0 w-1 border-l-2 border-on-accent bg-text1" />
                <span aria-hidden="true" data-video-trim-boundary="end" className="absolute inset-y-0 right-0 w-1 border-r-2 border-on-accent bg-text1" />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <UiIconButton size="sm" onClick={togglePlay} tooltip={t('ui:audioPlayer.playPause')}>
            {isVideoPlaying ? <Pause /> : <Play />}
          </UiIconButton>
          <div className={`ml-1 text-xs text-text1 ${UI_TEXT_TIMECODE_CLASS}`}>
            {formatTime(currentTime)} <span className="text-text3">/ {formatTime(videoDuration)}</span>
          </div>
          {isBuffering && (
            <div className="ml-2 text-xs text-text2">{t('ui:workspace.status.buffering')}</div>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {hasAudio !== false && (
              <div ref={volumeRef} className="relative" onMouseEnter={showVolume} onMouseLeave={hideVolume}>
                {volumeOpen && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2">
                    <VolumePopover value={effectiveVolume} label={t('ui:viewer.volume')} onChange={(next) => updateVolume(next)} />
                  </div>
                )}
                <UiIconButton size="sm" onClick={() => setMuted((value) => !value)} aria-label={muted ? t('ui:viewer.unmute') : t('ui:viewer.mute')} tooltip={volumeOpen ? undefined : muted ? t('ui:viewer.unmute') : t('ui:viewer.mute')}>
                  <VolumeIcon />
                </UiIconButton>
              </div>
            )}
            {hasAudio !== false && (
              <UiIconButton
                size="sm"
                on={autoGain && !autoGainUnavailable}
                aria-pressed={autoGain && !autoGainUnavailable}
                disabled={Boolean(autoGainUnavailable)}
                disabledReason={autoGainUnavailable}
                onClick={() => onAutoGainChange(!autoGain)}
                tooltip={t('ui:viewer.autoGain')}
              >
                <Waves />
              </UiIconButton>
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
            <UiIconButton size="sm" on={loop} aria-pressed={loop} onClick={() => setLoop((value) => !value)} tooltip={t('ui:viewer.loop')}>
              <Repeat />
            </UiIconButton>
            {fullscreen && (
              <UiIconButton size="sm" onClick={fullscreen.toggle} tooltip={fullscreen.active ? t('ui:viewer.exitFullscreen') : t('ui:viewer.fullscreen')}>
                {fullscreen.active ? <Minimize /> : <Maximize />}
              </UiIconButton>
            )}
            {onDownload && filePath && (
              <UiIconButton size="sm" onClick={() => onDownload(filePath)} tooltip={t('common:actions.download')}>
                <Download />
              </UiIconButton>
            )}
          </div>
        </div>
      </UiPanel>
    </div>
  )
}
