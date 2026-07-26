import React, { useEffect, useRef, useState } from 'react'
import { downloadAudioFile, saveAudioFromUrl } from '@/utils/save'
import { UiIconButton, UiRangeInput, UI_PANEL_SURFACE_CLASS } from '@/components/ui'
import Waveform from './Waveform'
import { useI18n } from '@/hooks/useI18n'
import { useAudioWaveform } from '@/hooks/useAudioWaveform'
import { Download, Pause, Play, Volume2, VolumeX } from 'lucide-react'

interface AudioPlayerProps {
  src: string
  filePath?: string
  className?: string
  onContextMenu?: (e: React.MouseEvent) => void
  compact?: boolean
  waveformWidth?: number
  waveformHeight?: number
  rightActions?: React.ReactNode
  autoPlay?: boolean
  active?: boolean
  /**
   * 外壳表面由**宿主**决定，而不是播放器自己硬定：
   * - `card`（默认）：完整卡片表面，用于播放器是主体内容的场景（如音频查看器弹窗）
   * - `plain`：无边框无背景，用于外层已有层级的场景（任务卡结果区、语音克隆预览卡内）
   *
   * 默认值保持 `card`，未传参的调用点行为不变。
   */
  surface?: 'card' | 'plain'
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  filePath,
  className,
  onContextMenu,
  compact = false,
  waveformWidth,
  waveformHeight,
  rightActions,
  autoPlay = false,
  active = true,
  surface = 'card',
}) => {
  const { t } = useI18n()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [isAdjustingVolume, setIsAdjustingVolume] = useState(false)
  const [showVolumeValueTip, setShowVolumeValueTip] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const resolvedWaveformWidth = waveformWidth ?? (compact ? 300 : 576)
  const resolvedWaveformHeight = waveformHeight ?? (compact ? 60 : 72)
  const { waveform, waveDuration } = useAudioWaveform(src, filePath, {
    width: resolvedWaveformWidth,
    compact,
    duration,
  })
  const volumeContainerRef = useRef<HTMLDivElement | null>(null)
  const volumeTipTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.pause()
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    try {
      a.currentTime = 0
    } catch {
      // Ignore media reset failures from unloaded audio elements.
    }
    const onLoaded = () => setDuration(a.duration || 0)
    const onTime = () => setCurrentTime(a.currentTime || 0)
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
  }, [autoPlay, src])

  useEffect(() => {
    if (active) return
    const audio = audioRef.current
    audio?.pause()
    setIsPlaying(false)
  }, [active])

  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    if (isPlaying) {
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
  }, [isPlaying, src])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.volume = volume
  }, [volume])

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

  const onVolumeWheel = (event: React.WheelEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const direction = event.deltaY < 0 ? 1 : -1
    const nextVolume = volume + direction * 0.05
    applyVolume(nextVolume)
    showVolumeTipTemporarily(700)
  }

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
  const volumeSliderWidthClass = compact ? 'w-[6.75rem]' : 'w-32'

  return (
    <div
      className={`${compact ? 'w-full min-w-0' : 'w-[36rem]'} ${surface === 'card' ? `rounded-xl p-4 ${UI_PANEL_SURFACE_CLASS}` : 'p-0'} outline-none ${className || ''}`}
      onContextMenu={onContextMenu}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault()
          e.stopPropagation()
          togglePlay()
        }
      }}
    >
      <div className={`${compact ? 'mb-1.5' : 'mb-2'} flex items-center justify-between text-xs text-text-soft`}>
        <span>{format(currentTime)}</span>
        <span>{format(waveDuration ?? duration)}</span>
      </div>
      <div className={`${compact ? 'mb-2 h-[48px]' : 'mb-3 h-[72px]'}`}>
        {waveform ? (
          <Waveform
            samples={waveform}
            width={resolvedWaveformWidth}
            height={resolvedWaveformHeight}
            progress={audioRef.current && audioRef.current.duration ? currentTime / audioRef.current.duration : (duration ? currentTime / duration : 0)}
            duration={audioRef.current && audioRef.current.duration ? audioRef.current.duration : (duration || 0)}
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
        ) : (
          <div className="w-full h-full rounded-md bg-layer" />
        )}
      </div>
      <div className={`${compact ? 'mt-2' : 'mt-3'} flex items-center justify-between`}>
        <div ref={volumeContainerRef} className="relative flex items-center">
          <UiIconButton
            className={`${compact ? '!h-7 !w-7' : '!h-8 !w-8'} border-0 bg-transparent text-text-soft hover:opacity-70`}
            title={t('ui:audioPlayer.volume')}
            onClick={() => setShowVolumeSlider((value) => !value)}
          >
            {volume <= 0 ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
          </UiIconButton>
          {showVolumeSlider && (
            <div
              className={`absolute left-[calc(100%+0.5rem)] top-1/2 z-20 -translate-y-1/2 ${volumeSliderWidthClass}`}
              onWheelCapture={onVolumeWheel}
            >
              {/* 音量数值 tooltip 是浮层，边框背景是其在波形上可读所必需的 */}
              {showVolumeValueTip && (
                <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-md border border-border-dark/70 bg-surface-dark/95 px-1.5 py-0.5 text-2xs text-text-dark">
                  {volumePercent}%
                </div>
              )}
              <UiRangeInput
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
        <div className="flex items-center">
          <UiIconButton onClick={togglePlay} className={`${compact ? '!h-7 !w-7' : '!h-8 !w-8'} border-0 bg-transparent text-text-soft hover:opacity-70`} title={t('ui:audioPlayer.playPause')}>
            {isPlaying ? (
              <Pause className={`${compact ? 'h-[18px] w-[18px]' : 'h-5 w-5'}`} />
            ) : (
              <Play className={`${compact ? 'h-[18px] w-[18px]' : 'h-5 w-5'}`} />
            )}
          </UiIconButton>
        </div>
        <div className="flex items-center gap-1">
          {rightActions}
          <UiIconButton
            onClick={() => { void handleDownload() }}
            disabled={isDownloading}
            className={`${compact ? '!h-7 !w-7' : '!h-8 !w-8'} border-0 bg-transparent ${isDownloading ? 'text-text-faint opacity-40 cursor-not-allowed' : 'text-text-soft hover:opacity-70'} transition-opacity`}
            title={t('common:actions.download')}
          >
            <Download className={`${compact ? 'h-[18px] w-[18px]' : 'h-5 w-5'}`} />
          </UiIconButton>
        </div>
      </div>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
    </div>
  )
}

export default AudioPlayer

