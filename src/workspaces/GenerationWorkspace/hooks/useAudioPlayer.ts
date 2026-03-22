import { useState, useCallback, useRef } from 'react'

/**
 * 音频播放器 Hook
 * 职责：管理音频播放器的状态
 */

export const useAudioPlayer = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [currentAudio, setCurrentAudio] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  const openPlayer = useCallback((audioUrl: string) => {
    setCurrentAudio(audioUrl)
    setIsOpen(true)
    setIsPlaying(false)
    setCurrentTime(0)
  }, [])

  const closePlayer = useCallback(() => {
    setIsOpen(false)
    setCurrentAudio(null)
    setIsPlaying(false)
    setCurrentTime(0)
  }, [])

  const play = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }, [])

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }, [])

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause()
    } else {
      play()
    }
  }, [isPlaying, play, pause])

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time
      setCurrentTime(time)
    }
  }, [])

  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }, [isMuted])

  const changeVolume = useCallback((newVolume: number) => {
    if (audioRef.current) {
      audioRef.current.volume = newVolume
      setVolume(newVolume)
    }
  }, [])

  return {
    isOpen,
    currentAudio,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    audioRef,
    openPlayer,
    closePlayer,
    play,
    pause,
    togglePlay,
    seek,
    toggleMute,
    changeVolume,
    setCurrentTime,
    setDuration
  }
}
