import React, { useEffect, useMemo, useRef, useState } from 'react'
import { downloadAudioFile, saveAudioFromUrl } from '@/utils/save'
import { UiIconButton, UiRangeInput } from '@/components/ui'
import Waveform from './Waveform'
import { useI18n } from '@/hooks/useI18n'
import { nativeFetch, readFile } from '@/platform/desktopApi'
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
}

const SAFE_LOCAL_WAVEFORM_HOSTS = new Set(['localhost', '127.0.0.1', 'asset.localhost', 'tauri.localhost'])
const WAVEFORM_ALGO_VERSION = '2026-03-25-v4'
const waveformMemoryCache = new Map<string, number[]>()

function isCrossOriginWaveformRestricted(source: string): boolean {
  if (!source || typeof window === 'undefined') {
    return false
  }
  try {
    const parsed = new URL(source, window.location.href)
    if (parsed.protocol === 'blob:' || parsed.protocol === 'data:' || parsed.protocol === 'file:') {
      return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }
    if (SAFE_LOCAL_WAVEFORM_HOSTS.has(parsed.hostname.toLowerCase())) {
      return false
    }
    return parsed.origin !== window.location.origin
  } catch {
    return false
  }
}

function buildFallbackWaveform(seed: string, bars = 256): number[] {
  let state = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index)
    state = Math.imul(state, 16777619) >>> 0
  }
  const result: number[] = []
  for (let index = 0; index < bars; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const noise = (state & 0xffff) / 0xffff
    const envelope = Math.sin((index / Math.max(1, bars - 1)) * Math.PI)
    const value = 0.12 + envelope * 0.46 + noise * 0.22
    result.push(Math.max(0.06, Math.min(1, value)))
  }
  return result
}

function smoothWaveform(values: number[], radius = 2): number[] {
  if (values.length <= 2 || radius <= 0) {
    return values
  }
  const result: number[] = new Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    let sum = 0
    let count = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = values[index + offset]
      if (typeof value === 'number') {
        sum += value
        count += 1
      }
    }
    result[index] = count > 0 ? sum / count : values[index]
  }
  return result
}

async function fetchAudioArrayBuffer(source: string, localFilePath?: string): Promise<ArrayBuffer> {
  if (localFilePath) {
    const bytes = await readFile(localFilePath)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
  if (isCrossOriginWaveformRestricted(source)) {
    const response = await nativeFetch(source, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`waveform native fetch failed: ${response.status}`)
    }
    return response.arrayBuffer()
  }
  const response = await fetch(source, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`waveform fetch failed: ${response.status}`)
  }
  return response.arrayBuffer()
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
  const [waveform, setWaveform] = useState<number[] | null>(null)
  const [waveDuration, setWaveDuration] = useState<number | null>(null)
  const resolvedWaveformWidth = waveformWidth ?? (compact ? 300 : 576)
  const resolvedWaveformHeight = waveformHeight ?? (compact ? 60 : 72)
  const targetBars = useMemo(
    () => Math.max(96, Math.min(320, Math.floor(resolvedWaveformWidth * (compact ? 0.72 : 0.62)))),
    [resolvedWaveformWidth, compact]
  )
  const cacheSourceKey = useMemo(() => filePath?.trim() || src, [filePath, src])
  const cacheKey = useMemo(
    () => `${cacheSourceKey}::${targetBars}::${compact ? 'compact' : 'default'}::${WAVEFORM_ALGO_VERSION}`,
    [cacheSourceKey, targetBars, compact]
  )
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
    return () => {
      a.removeEventListener('loadedmetadata', onLoaded)
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('ended', onEnd)
    }
  }, [src])

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

  useEffect(() => {
    let aborted = false
    const run = async () => {
      const cachedWaveform = waveformMemoryCache.get(cacheKey)
      if (cachedWaveform) {
        if (!aborted) {
          setWaveform(cachedWaveform)
          setWaveDuration((prev) => prev || duration || null)
        }
        return
      }
      if (!aborted) {
        setWaveDuration(null)
      }
      try {
        const buf = await fetchAudioArrayBuffer(src, filePath)
        const Ctx = window.AudioContext ?? ((window as DynamicValue as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        if (!Ctx) {
          if (!aborted) {
            const fallback = buildFallbackWaveform(cacheKey)
            waveformMemoryCache.set(cacheKey, fallback)
            setWaveform(fallback)
          }
          return
        }
        const ctx = new Ctx()
        const audioBuf = await ctx.decodeAudioData(buf)
        const ch0 = audioBuf.getChannelData(0)
        const ch1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : null
        const bars = targetBars
        const step = Math.floor(ch0.length / bars) || 1
        const arr: number[] = []
        for (let i = 0; i < bars; i++) {
          let peak = 0
          let sumSquares = 0
          let count = 0
          const start = i * step
          const end = Math.min(ch0.length, start + step)
          for (let j = start; j < end; j++) {
            const v = ch1
              ? (Math.abs(ch0[j]) + Math.abs(ch1[j])) * 0.5
              : Math.abs(ch0[j])
            sumSquares += v * v
            count += 1
            if (v > peak) peak = v
          }
          const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0
          arr.push(Math.max(rms * 1.2, peak * 0.65))
        }
        const sorted = [...arr].sort((a, b) => a - b)
        const percentile = (ratio: number): number => {
          if (sorted.length === 0) return 0
          const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)))
          return sorted[index]
        }
        const low = percentile(0.1)
        const high = percentile(0.98)
        const range = Math.max(1e-6, high - low)
        const norm = arr.map((v) => Math.max(0, Math.min(1, (v - low) / range)))
        const expanded = norm.map((v) => Math.pow(v, compact ? 0.72 : 0.78))
        const smooth = smoothWaveform(expanded, compact ? 1 : 2).map((v) => {
          const floor = compact ? 0.014 : 0.004
          return Math.max(floor, Math.min(1, v))
        })
        if (!aborted) {
          waveformMemoryCache.set(cacheKey, smooth)
          setWaveform(smooth)
          setWaveDuration(audioBuf.duration || null)
        }
      } catch {
        if (!aborted) {
          const fallback = buildFallbackWaveform(cacheKey)
          waveformMemoryCache.set(cacheKey, fallback)
          setWaveform(fallback)
        }
      }
    }
    run()
    return () => { aborted = true }
  }, [cacheKey, src, filePath, targetBars, compact, duration])
  const volumePercent = Math.round(volume * 100)
  const volumeSliderWidthClass = compact ? 'w-[6.75rem]' : 'w-32'

  return (
    <div
      className={`${compact ? 'w-full min-w-0' : 'w-[36rem]'} bg-panel/70 rounded-xl border border-zinc-700/50 p-4 outline-none ${className || ''}`}
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
      <div className={`${compact ? 'mb-1.5' : 'mb-2'} flex items-center justify-between text-xs text-zinc-300`}>
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
            className={`${compact ? '!h-7 !w-7' : '!h-8 !w-8'} border-0 bg-transparent text-zinc-300 hover:opacity-70`}
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
              {showVolumeValueTip && (
                <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-md border border-border-dark/70 bg-surface-dark/95 px-1.5 py-0.5 text-[11px] text-zinc-200">
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
          <UiIconButton onClick={togglePlay} className={`${compact ? '!h-7 !w-7' : '!h-8 !w-8'} border-0 bg-transparent text-zinc-300 hover:opacity-70`} title={t('ui:audioPlayer.playPause')}>
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
            className={`${compact ? '!h-7 !w-7' : '!h-8 !w-8'} border-0 bg-transparent ${isDownloading ? 'text-zinc-500 opacity-40 cursor-not-allowed' : 'text-zinc-300 hover:opacity-70'} transition-opacity`}
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

