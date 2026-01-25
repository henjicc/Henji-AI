/**
 * 视频播放器组件
 * 职责：播放视频并提供控制功能
 */

import React, { useRef, useEffect } from 'react'
import { useI18n } from '@/hooks/useI18n'

interface VideoPlayerProps {
  videoUrl: string
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onVolumeChange: (volume: number) => void
  onMuteToggle: () => void
  onClose: () => void
  onDownload?: () => void
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoUrl,
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  onPlay,
  onPause,
  onSeek,
  onVolumeChange,
  onMuteToggle,
  onClose,
  onDownload
}) => {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play()
      } else {
        videoRef.current.pause()
      }
    }
  }, [isPlaying])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = currentTime
    }
  }, [currentTime])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
    }
  }, [volume])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted
    }
  }, [isMuted])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="video-player-overlay" onClick={onClose}>
      <div className="video-player-container" onClick={(e) => e.stopPropagation()}>
        <div className="video-player-header">
          {onDownload && (
            <button className="player-btn" onClick={onDownload} title={t('common:actions.download')}>
              ⬇️
            </button>
          )}
          <button className="player-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="video-player-content">
          <video
            ref={videoRef}
            src={videoUrl}
            className="video-element"
          />
        </div>

        <div className="video-player-controls">
          <button
            className="control-btn play-pause"
            onClick={isPlaying ? onPause : onPlay}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          <div className="progress-container">
            <input
              type="range"
              min="0"
              max={duration}
              value={currentTime}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="progress-bar"
            />
            <div className="time-display">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          <button
            className="control-btn mute"
            onClick={onMuteToggle}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>

          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="volume-slider"
          />
        </div>
      </div>
    </div>
  )
}
