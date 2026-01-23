import { useState, useCallback, useRef } from 'react'

/**
 * 视频播放器 Hook
 * 职责：管理视频播放器的状态
 */

export const useVideoPlayer = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [currentVideo, setCurrentVideo] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const openPlayer = useCallback((videoUrl: string) => {
    setCurrentVideo(videoUrl)
    setIsOpen(true)
    setIsPlaying(false)
    setCurrentTime(0)
  }, [])

  const closePlayer = useCallback(() => {
    setIsOpen(false)
    setCurrentVideo(null)
    setIsPlaying(false)
    setCurrentTime(0)
  }, [])

  const play = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.play()
      setIsPlaying(true)
    }
  }, [])

  const pause = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause()
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
    if (videoRef.current) {
      videoRef.current.currentTime = time
      setCurrentTime(time)
    }
  }, [])

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }, [isMuted])

  const changeVolume = useCallback((newVolume: number) => {
    if (videoRef.current) {
      videoRef.current.volume = newVolume
      setVolume(newVolume)
    }
  }, [])

  return {
    isOpen,
    currentVideo,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    videoRef,
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
