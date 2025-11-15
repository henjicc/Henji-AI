import React, { useEffect, useRef, useState } from 'react'
import { downloadAudioFile } from '@/utils/save'

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

  return (
    <div className={`w-[36rem] bg-[#131313]/70 rounded-xl border border-[rgba(46,46,46,0.8)] p-4 ${className || ''}`}>
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className={`w-12 h-12 rounded-full flex items-center justify-center ${isPlaying ? 'bg-white text-black' : 'bg-[#007eff] text-white'}`}
        >
          {isPlaying ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7-11-7z" />
            </svg>
          )}
        </button>
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs text-zinc-300 mb-1">
            <span>{format(currentTime)}</span>
            <span>{format(duration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, duration || 0)}
            step={0.01}
            value={Math.min(currentTime, duration || 0)}
            onChange={onSeek}
            className="w-full accent-[#007eff]"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-zinc-300" viewBox="0 0 1024 1024" fill="currentColor">
            <path d="M468.992 169.536c29.312-22.528 64.128-40.768 101.312-25.088 36.864 15.616 48.64 53.12 53.76 90.048 5.248 37.824 5.248 89.92 5.248 154.688v245.568c0 64.768 0 116.864-5.184 154.752-5.12 36.864-16.96 74.368-53.76 89.984-37.248 15.744-72.064-2.56-101.376-25.088-30.016-23.04-68.032-61.888-112.832-107.584-23.04-23.552-38.336-34.944-53.76-41.28-15.616-6.4-34.496-9.152-67.456-9.152-28.544 0-54.08 0-73.408-2.048-20.224-2.112-39.04-6.656-56-18.24-32.192-22.016-44.544-54.208-49.28-83.84C52.864 570.24 53.248 545.984 53.568 526.464v-28.928c-0.32-19.52-0.64-43.776 2.816-65.92 4.672-29.568 17.024-61.76 49.28-83.776 16.896-11.52 35.712-16.128 55.936-18.24 19.328-1.984 44.8-1.984 73.344-1.984 33.024 0 51.904-2.752 67.456-9.152 15.488-6.4 30.72-17.792 53.76-41.28 44.8-45.696 82.88-84.608 112.896-107.648z"></path>
            <path d="M699.52 350.08a42.688 42.688 0 0 1 59.776 8.064c32.256 42.24 51.392 95.872 51.392 153.856 0 57.92-19.136 111.552-51.392 153.856a42.688 42.688 0 1 1-67.84-51.712c21.056-27.648 33.92-63.104 33.92-102.144 0-39.04-12.864-74.496-33.92-102.144a42.688 42.688 0 0 1 8-59.776z"></path>
            <path d="M884.8 269.824a42.688 42.688 0 1 0-62.912 57.6C868.736 378.688 896 442.88 896 512c0 69.12-27.264 133.312-74.112 184.512a42.688 42.688 0 0 0 62.912 57.6c59.904-65.344 96.512-149.632 96.512-242.112 0-92.48-36.608-176.768-96.512-242.176z"></path>
          </svg>
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={onVolume} className="w-28 accent-[#007eff]" />
        </div>
        <button
          onClick={async () => { if (filePath) { try { await downloadAudioFile(filePath) } catch {} } }}
          disabled={!filePath}
          className={`${filePath ? 'text-zinc-300 hover:opacity-70' : 'text-zinc-500 opacity-40 cursor-not-allowed'} transition-opacity`}
          title="下载"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        </button>
      </div>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
    </div>
  )
}

export default AudioPlayer
