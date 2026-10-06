import React, { useEffect, useRef, useState } from 'react'
import { useNonPassiveWheel } from '@/hooks/useNonPassiveWheel'
import { downloadAudioFile, saveAudioFromUrl } from '@/utils/save'
import { UiIconButton, UiRangeInput, UI_PANEL_SURFACE_CLASS, UI_TEXT_TIMECODE_CLASS } from '@/components/ui'
import { WaveformView } from './waveform/WaveformView'
import { useI18n } from '@/hooks/useI18n'
import { useWaveformData } from '@/hooks/useWaveformData'
import { Download, Pause, Play, Volume2, VolumeX } from 'lucide-react'

export interface AudioPlaybackState {
  currentTime: number
  volume: number
}

export interface ControlledAudioPlayback {
  currentTime: number
  duration: number
  playing: boolean
  volume: number
  disabled?: boolean
  onTogglePlay: () => void
  onSeek: (seconds: number) => void
  onVolume: (volume: number) => void
}

interface AudioPlayerProps {
  src: string
  filePath?: string
  className?: string
  onContextMenu?: (e: React.MouseEvent) => void
  compact?: boolean
  /** 波形高度（CSS 像素）；不传则填满波形区。 */
  waveformHeight?: number
  rightActions?: React.ReactNode
  autoPlay?: boolean
  active?: boolean
  /** 虚拟列表重新挂载暂停的播放器时恢复位置和音量。 */
  initialPlaybackState?: AudioPlaybackState
  onActivityChange?: (active: boolean) => void
  /** Host-owned playback: controls project confirmed state, without creating another decoder or waveform analysis. */
  controlledPlayback?: ControlledAudioPlayback
  /**
   * 外壳表面由**宿主**决定，而不是播放器自己硬定：
   * - `card`（默认）：完整卡片表面，用于播放器是主体内容的场景（如音频查看器弹窗）
   * - `plain`：无边框无背景，用于外层已有层级的场景（任务卡结果区、语音克隆预览卡内）
   *
   * 默认值保持 `card`，未传参的调用点行为不变。
   */
  surface?: 'card' | 'plain'
  /**
   * 排布：`stacked`（默认）= 时间行 + 波形 + 控制行；`inline` = 一行迷你播放条
   * （播放 · 迷你波形 · 时间 · 音量），用于生成记录等列表（设计稿 Generation，界面重设计 3.2）。
   * `inline` 不带下载按钮：列表行自己的工具条已经提供下载。
   */
  layout?: 'stacked' | 'inline'
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  filePath,
  className,
  onContextMenu,
  compact = false,
  waveformHeight,
  rightActions,
  autoPlay = false,
  active = true,
  initialPlaybackState,
  onActivityChange,
  controlledPlayback,
  surface = 'card',
  layout = 'stacked',
}) => {
  const { t } = useI18n()
  const audioRef = useRef<HTMLAudioElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const visibleRef = useRef(true)
  const [isVisible, setIsVisible] = useState(true)
  const restoreRef = useRef({ src, state: initialPlaybackState })
  const [internalPlaying, setIsPlaying] = useState(false)
  const [internalTime, setCurrentTime] = useState(initialPlaybackState?.currentTime ?? 0)
  const [internalDuration, setDuration] = useState(0)
  const [internalVolume, setVolume] = useState(initialPlaybackState?.volume ?? 1)
  const isPlaying = controlledPlayback?.playing ?? internalPlaying
  const currentTime = controlledPlayback?.currentTime ?? internalTime
  const duration = controlledPlayback?.duration ?? internalDuration
  const volume = controlledPlayback?.volume ?? internalVolume
  const controlled = controlledPlayback !== undefined
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [isAdjustingVolume, setIsAdjustingVolume] = useState(false)
  const [showVolumeValueTip, setShowVolumeValueTip] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const waveformSource = controlled ? '' : filePath?.trim() || src
  const waveform = useWaveformData(waveformSource ? { source: waveformSource, channels: 1 } : null)
  const wavePyramid = waveform.data?.pyramid
  const waveDuration = wavePyramid ? wavePyramid.endSeconds - wavePyramid.startSeconds : null
  const volumeContainerRef = useRef<HTMLDivElement | null>(null)
  const volumeTipTimerRef = useRef<number | null>(null)

  useEffect(() => {
    onActivityChange?.(isPlaying || isDownloading || isAdjustingVolume || showVolumeSlider)
    return () => onActivityChange?.(false)
  }, [isPlaying, isDownloading, isAdjustingVolume, showVolumeSlider, onActivityChange])

  useEffect(() => {
    if (!playerRef.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting
      setIsVisible(entry.isIntersecting)
      if (entry.isIntersecting && !controlled) setCurrentTime(audioRef.current?.currentTime ?? 0)
    })
    observer.observe(playerRef.current)
    return () => observer.disconnect()
  }, [controlled])

  useEffect(() => {
    if (controlled) return
    const a = audioRef.current
    if (!a) return
    a.pause()
    setIsPlaying(false)
    if (restoreRef.current.src !== src) restoreRef.current = { src, state: undefined }
    const restoreTime = restoreRef.current.state?.currentTime ?? 0
    setCurrentTime(restoreTime)
    setDuration(0)
    try {
      a.currentTime = restoreTime
    } catch {
      // Ignore media reset failures from unloaded audio elements.
    }
    const onLoaded = () => {
      setDuration(a.duration || 0)
      if (restoreTime > 0) {
        a.currentTime = Math.min(restoreTime, Number.isFinite(a.duration) ? a.duration : restoreTime)
        setCurrentTime(a.currentTime)
      }
    }
    const onTime = () => { if (visibleRef.current) setCurrentTime(a.currentTime || 0) }
    const onEnd = () => setIsPlaying(false)
    a.addEventListener('loadedmetadata', onLoaded)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('ended', onEnd)
    if (autoPlay) {
      void a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
    }
    return () => {
      a.removeEventListener('loadedmetadata', onLoaded)
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('ended', onEnd)
    }
  }, [autoPlay, src, controlled])

  useEffect(() => {
    if (active || controlled) return
    const audio = audioRef.current
    audio?.pause()
    setIsPlaying(false)
  }, [active, controlled])

  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (controlled) return
    const a = audioRef.current
    if (!a) return
    if (isPlaying && isVisible) {
      const tick = () => {
        setCurrentTime(a.currentTime || 0)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [isPlaying, isVisible, src, controlled])

  useEffect(() => {
    if (controlled) return
    const a = audioRef.current
    if (!a) return
    a.volume = volume
  }, [volume, controlled])

  useEffect(() => {
    if (!showVolumeSlider) {
      setIsAdjustingVolume(false)
      setShowVolumeValueTip(false)
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!volumeContainerRef.current?.contains(event.target as Node)) {
        setShowVolumeSlider(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowVolumeSlider(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showVolumeSlider])

  useEffect(() => () => {
    if (volumeTipTimerRef.current) {
      window.clearTimeout(volumeTipTimerRef.current)
      volumeTipTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isAdjustingVolume) {
      return
    }
    const handlePointerUp = () => {
      setIsAdjustingVolume(false)
      if (volumeTipTimerRef.current) {
        window.clearTimeout(volumeTipTimerRef.current)
      }
      volumeTipTimerRef.current = window.setTimeout(() => {
        setShowVolumeValueTip(false)
        volumeTipTimerRef.current = null
      }, 700)
    }
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [isAdjustingVolume])

  const togglePlay = async () => {
    if (controlledPlayback) { if (active && !controlledPlayback.disabled) controlledPlayback.onTogglePlay(); return }
    const a = audioRef.current
    if (!a) return
    if (isPlaying) {
      a.pause()
      setIsPlaying(false)
    } else {
      try {
        await a.play()
        setIsPlaying(true)
      } catch {
        setIsPlaying(false)
      }
    }
  }

  const format = (s: number) => {
    const t = Math.max(0, Math.floor(s))
    const mm = Math.floor(t / 60)
    const ss = t % 60
    return `${mm}:${ss.toString().padStart(2, '0')}`
  }

  const applyVolume = (nextVolume: number): void => {
    const clampedVolume = Math.max(0, Math.min(1, Number.isFinite(nextVolume) ? nextVolume : 1))
    if (controlledPlayback) { if (active && !controlledPlayback.disabled) controlledPlayback.onVolume(clampedVolume); return }
    setVolume(clampedVolume)
  }

  const showVolumeTipTemporarily = (durationMs: number): void => {
    setShowVolumeValueTip(true)
    if (volumeTipTimerRef.current) {
      window.clearTimeout(volumeTipTimerRef.current)
    }
    volumeTipTimerRef.current = window.setTimeout(() => {
      setShowVolumeValueTip(false)
      volumeTipTimerRef.current = null
    }, durationMs)
  }

  const onVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    applyVolume(v)
    if (!isAdjustingVolume) {
      showVolumeTipTemporarily(700)
    }
  }

  const volumeSliderRef = useRef<HTMLDivElement>(null)
  const onVolumeWheel = (event: WheelEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const direction = event.deltaY < 0 ? 1 : -1
    const nextVolume = volume + direction * 0.05
    applyVolume(nextVolume)
    showVolumeTipTemporarily(700)
  }  // 音量浮层上滚轮调音量并拦住波形/页面滚动：React onWheel 是被动的，走非被动原生监听
  useNonPassiveWheel(volumeSliderRef, onVolumeWheel, showVolumeSlider)


  const handleDownload = async (): Promise<void> => {
    if (isDownloading || !src) {
      return
    }
    try {
      setIsDownloading(true)
      if (filePath) {
        await downloadAudioFile(filePath)
        return
      }
      const saved = await saveAudioFromUrl(src)
      await downloadAudioFile(saved.fullPath)
    } catch {
      try {
        const anchor = document.createElement('a')
        anchor.href = src
        anchor.download = `audio-${Date.now()}.mp3`
        anchor.target = '_blank'
        anchor.rel = 'noopener'
        anchor.click()
      } catch {
        // Browser download fallback is best-effort only.
      }
    } finally {
      setIsDownloading(false)
    }
  }

  const volumePercent = Math.round(volume * 100)
  const volumeSliderWidthClass = compact ? 'w-28' : 'w-32'

  const keyboardToggle = (e: React.KeyboardEvent): void => {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault()
      e.stopPropagation()
      togglePlay()
    }
  }
  const iconSize = compact || layout === 'inline' ? 'h-4 w-4' : 'h-5 w-5'
  const buttonSize = compact || layout === 'inline' ? 'md' : 'lg'
  const playButton = (
    <UiIconButton disabled={!active || controlledPlayback?.disabled} onClick={togglePlay} size={buttonSize} title={t('ui:audioPlayer.playPause')}>
      {isPlaying ? <Pause className={iconSize} /> : <Play className={iconSize} />}
    </UiIconButton>
  )
  const waveformView = (height?: number, tier?: 'mini' | 'standard') => (
    <WaveformView
      waveform={waveform}
      {...(height !== undefined ? { height } : {})}
      {...(tier ? { tier } : {})}
      playedSeconds={(wavePyramid?.startSeconds ?? 0) + currentTime}
      durationSeconds={audioRef.current && audioRef.current.duration ? audioRef.current.duration : (duration || 0)}
      onSeekStart={(r) => { if (audioRef.current) { const d = audioRef.current.duration || duration || 0; audioRef.current.currentTime = r * d } }}
      onSeekMove={(r) => { if (audioRef.current) { const d = audioRef.current.duration || duration || 0; audioRef.current.currentTime = r * d } }}
      onSeekEnd={(r, dragged) => {
        if (!audioRef.current || !duration) return
        const d = audioRef.current.duration || duration || 0
        audioRef.current.currentTime = r * d
        if (dragged) {
          audioRef.current.play().catch(() => { })
          setIsPlaying(true)
        }
      }}
    />
  )
  const volumeControl = (
    <div ref={volumeContainerRef} className="relative flex items-center">
      <UiIconButton
        size={buttonSize}
        title={t('ui:audioPlayer.volume')}
        disabled={!active || controlledPlayback?.disabled}
        onClick={() => setShowVolumeSlider((value) => !value)}
      >
        {volume <= 0 ? <VolumeX className={iconSize} /> : <Volume2 className={iconSize} />}
      </UiIconButton>
      {showVolumeSlider && (
        <div
          className={`absolute ${layout === 'inline' ? 'right-[calc(100%+0.5rem)]' : 'left-[calc(100%+0.5rem)]'} top-1/2 z-sticky -translate-y-1/2 ${volumeSliderWidthClass}`}
          ref={volumeSliderRef}
        >
          {/* 音量数值 tooltip 是浮层，边框背景是其在波形上可读所必需的 */}
          {showVolumeValueTip && (
            <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-md border border-line/70 bg-raised/95 px-1.5 py-0.5 text-2xs text-text1">
              {volumePercent}%
            </div>
          )}
          <UiRangeInput
            disabled={!active || controlledPlayback?.disabled}
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={onVolume}
            onPointerDown={() => {
              setIsAdjustingVolume(true)
              setShowVolumeValueTip(true)
              if (volumeTipTimerRef.current) {
                window.clearTimeout(volumeTipTimerRef.current)
                volumeTipTimerRef.current = null
              }
            }}
            className="w-full"
          />
        </div>
      )}
    </div>
  )
  const audioElement = !controlled && <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

  if (layout === 'inline') {
    return (
      <div
        ref={playerRef}
        className={`flex w-full max-w-[32.5rem] items-center gap-2.5 outline-none ${className || ''}`}
        onContextMenu={onContextMenu}
        tabIndex={0}
        onKeyDown={keyboardToggle}
      >
        {playButton}
        <div className="h-7 min-w-0 flex-1">
          {controlledPlayback
            ? <UiRangeInput aria-label="音频播放位置" className="w-full" min={0} max={duration} step={0.001} value={currentTime} disabled={!active || controlledPlayback.disabled} onChange={event => controlledPlayback.onSeek(Number(event.target.value))} />
            : waveformView(28, 'mini')}
        </div>
        <span className={`shrink-0 text-xs text-text2 ${UI_TEXT_TIMECODE_CLASS}`}>
          {format(currentTime)} / {format(waveDuration ?? duration)}
        </span>
        {volumeControl}
        {rightActions}
        {audioElement}
      </div>
    )
  }

  return (
    <div
      ref={playerRef}
      className={`${compact ? 'w-full min-w-0' : 'w-[36rem]'} ${surface === 'card' ? `rounded-xl p-4 ${UI_PANEL_SURFACE_CLASS}` : 'p-0'} outline-none ${className || ''}`}
      onContextMenu={onContextMenu}
      tabIndex={0}
      onKeyDown={keyboardToggle}
    >
      <div className={`${compact ? 'mb-1.5' : 'mb-2'} flex items-center justify-between text-xs text-text2 ${UI_TEXT_TIMECODE_CLASS}`}>
        <span>{format(currentTime)}</span>
        <span>{format(waveDuration ?? duration)}</span>
      </div>
      <div className={controlled ? 'mb-2' : `${compact ? 'mb-2 h-12' : 'mb-3 h-[72px]'}`}>
        {controlledPlayback ? <UiRangeInput aria-label="音频播放位置" className="w-full" min={0} max={duration} step={0.001} value={currentTime} disabled={!active || controlledPlayback.disabled} onChange={event => controlledPlayback.onSeek(Number(event.target.value))} /> : waveformView(waveformHeight)}
      </div>
      <div className={`${compact ? 'mt-2' : 'mt-3'} flex items-center justify-between`}>
        {volumeControl}
        <div className="flex items-center">
          {playButton}
        </div>
        <div className="flex items-center gap-1">
          {rightActions}
          {!controlled && <UiIconButton
            onClick={() => { void handleDownload() }}
            disabled={isDownloading}
            size={buttonSize}
            title={t('common:actions.download')}
          >
            <Download className={iconSize} />
          </UiIconButton>}
        </div>
      </div>
      {audioElement}
    </div>
  )
}

export default AudioPlayer

