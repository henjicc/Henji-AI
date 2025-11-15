import React, { useEffect, useMemo, useRef, useState } from 'react'
import { downloadAudioFile } from '@/utils/save'
import Waveform from './Waveform'

interface AudioPlayerProps {
  src: string
  filePath?: string
  className?: string
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, filePath, className }) => {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [waveform, setWaveform] = useState<number[] | null>(null)
  const [waveDuration, setWaveDuration] = useState<number | null>(null)
  const [waveSampleRate, setWaveSampleRate] = useState<number | null>(null)
  const [waveTotalSamples, setWaveTotalSamples] = useState<number | null>(null)
  const cacheKey = useMemo(() => src, [src])
  const waveCacheRef = useRef<Map<string, number[]>>(new Map())

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
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

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current
    if (!a) return
    const v = parseFloat(e.target.value)
    a.currentTime = isNaN(v) ? 0 : v
    setCurrentTime(a.currentTime)
  }

  const onVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(isNaN(v) ? 1 : v)
  }

  useEffect(() => {
    let aborted = false
    const run = async () => {
      if (waveCacheRef.current.has(cacheKey)) {
        setWaveform(waveCacheRef.current.get(cacheKey) || null)
        return
      }
      try {
        const res = await fetch(src)
        const buf = await res.arrayBuffer()
        const Ctx: any = (window as any).AudioContext || (window as any).webkitAudioContext
        if (!Ctx) { setWaveform(null); return }
        const ctx = new Ctx()
        const audioBuf = await ctx.decodeAudioData(buf)
        const ch0 = audioBuf.getChannelData(0)
        const ch1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : null
        const merged = new Float32Array(ch0.length)
        for (let i = 0; i < ch0.length; i++) merged[i] = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i]
        const bars = 256
        const step = Math.floor(merged.length / bars) || 1
        const arr: number[] = []
        for (let i = 0; i < bars; i++) {
          let sum = 0
          let peak = 0
          const start = i * step
          const end = Math.min(merged.length, start + step)
          for (let j = start; j < end; j++) {
            const v = Math.abs(merged[j])
            sum += v * v
            if (v > peak) peak = v
          }
          const rms = Math.sqrt(sum / Math.max(1, end - start))
          const val = Math.max(rms, peak)
          arr.push(val)
        }
        const max = Math.max(...arr, 1e-6)
        const norm = arr.map(v => Math.max(0, Math.min(1, v / max)))
        const smooth: number[] = []
        const k = 0.5
        for (let i = 0; i < norm.length; i++) smooth[i] = i === 0 ? norm[i] : k * norm[i] + (1 - k) * smooth[i - 1]
        if (!aborted) {
          waveCacheRef.current.set(cacheKey, smooth)
          setWaveform(smooth)
          setWaveDuration(audioBuf.duration || null)
          setWaveSampleRate(audioBuf.sampleRate || null)
          setWaveTotalSamples(audioBuf.length || null)
        }
      } catch {
        setWaveform(null)
      }
    }
    run()
    return () => { aborted = true }
  }, [cacheKey, src])

  return (
    <div className={`w-[36rem] bg-[#131313]/70 rounded-xl border border-[rgba(46,46,46,0.8)] p-4 ${className || ''}`}>
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-300">
        <span>{format(currentTime)}</span>
        <span>{format(waveDuration ?? duration)}</span>
      </div>
      <div className="mb-3 h-[72px]">
        {waveform && waveSampleRate != null && waveTotalSamples != null ? (
          <Waveform
            samples={waveform}
            width={576}
            height={72}
            progress={audioRef.current && audioRef.current.duration ? currentTime / audioRef.current.duration : (duration ? currentTime / duration : 0)}
            duration={audioRef.current && audioRef.current.duration ? audioRef.current.duration : (duration || 0)}
            onSeekStart={(r) => { if (audioRef.current) { const d = audioRef.current.duration || duration || 0; audioRef.current.currentTime = r * d } }}
            onSeekMove={(r) => { if (audioRef.current) { const d = audioRef.current.duration || duration || 0; audioRef.current.currentTime = r * d } }}
            onSeekEnd={(r, dragged) => {
              if (!audioRef.current || !duration) return
              const d = audioRef.current.duration || duration || 0
              audioRef.current.currentTime = r * d
              if (dragged) {
                audioRef.current.play().catch(() => {})
                setIsPlaying(true)
              } else {
                if (isPlaying) { audioRef.current.pause(); setIsPlaying(false) } else { audioRef.current.play().catch(() => {}); setIsPlaying(true) }
              }
            }}
          />
        ) : (
          <div className="w-full h-full rounded-md bg-[#1B1C21]" />
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="relative flex items-center">
          <button className="text-zinc-300 hover:opacity-70" title="音量">
            <svg className="w-5 h-5" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M468.992 169.536c29.312-22.528 64.128-40.768 101.312-25.088 36.864 15.616 48.64 53.12 53.76 90.048 5.248 37.824 5.248 89.92 5.248 154.688v245.568c0 64.768 0 116.864-5.184 154.752-5.12 36.864-16.96 74.368-53.76 89.984-37.248 15.744-72.064-2.56-101.376-25.088-30.016-23.04-68.032-61.888-112.832-107.584-23.04-23.552-38.336-34.944-53.76-41.28-15.616-6.4-34.496-9.152-67.456-9.152-28.544 0-54.08 0-73.408-2.048-20.224-2.112-39.04-6.656-56-18.24-32.192-22.016-44.544-54.208-49.28-83.84C52.864 570.24 53.248 545.984 53.568 526.464v-28.928c-0.32-19.52-0.64-43.776 2.816-65.92 4.672-29.568 17.024-61.76 49.28-83.776 16.896-11.52 35.712-16.128 55.936-18.24 19.328-1.984 44.8-1.984 73.344-1.984 33.024 0 51.904-2.752 67.456-9.152 15.488-6.4 30.72-17.792 53.76-41.28 44.8-45.696 82.88-84.608 112.896-107.648z"></path>
              <path d="M699.52 350.08a42.688 42.688 0 0 1 59.776 8.064c32.256 42.24 51.392 95.872 51.392 153.856 0 57.92-19.136 111.552-51.392 153.856a42.688 42.688 0 1 1-67.84-51.712c21.056-27.648 33.92-63.104 33.92-102.144 0-39.04-12.864-74.496-33.92-102.144a42.688 42.688 0 0 1 8-59.776z"></path>
              <path d="M884.8 269.824a42.688 42.688 0 1 0-62.912 57.6C868.736 378.688 896 442.88 896 512c0 69.12-27.264 133.312-74.112 184.512a42.688 42.688 0 0 0 62.912 57.6c59.904-65.344 96.512-149.632 96.512-242.112 0-92.48-36.608-176.768-96.512-242.176z"></path>
            </svg>
          </button>
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={onVolume} className="absolute left-7 top-1 w-28 accent-[#007eff]" />
        </div>
        <div className="flex items-center">
          <button onClick={togglePlay} className="text-zinc-300 hover:opacity-70" title="播放/暂停">
            {isPlaying ? (
              <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
        </div>
        <div>
          <button
            onClick={async () => { if (filePath) { try { await downloadAudioFile(filePath) } catch {} } }}
            disabled={!filePath}
            className={`${filePath ? 'text-zinc-300 hover:opacity-70' : 'text-zinc-500 opacity-40 cursor-not-allowed'} transition-opacity`}
            title="下载"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
          </button>
        </div>
      </div>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
    </div>
  )
}

export default AudioPlayer
