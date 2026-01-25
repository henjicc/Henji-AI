/**
 * 音频播放器组件
 * 职责：播放音频并提供控制功能
 */

import React, { useRef, useEffect } from 'react'
import { useI18n } from '@/hooks/useI18n'

interface AudioPlayerProps {
  audioUrl: string
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
  onClose?: () => void
  onDownload?: () => void
  title?: string
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioUrl,
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
  onDownload,
  title
}) => {
  const { t } = useI18n()
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play()
      } else {
        audioRef.current.pause()
      }
    }
  }, [isPlaying])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = currentTime
    }
  }, [currentTime])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
    }
  }, [volume])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted
    }
  }, [isMuted])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={audioUrl}
        style={{ display: 'none' }}
      />

      {title && (
        <div className="audio-player-header">
          <span className="audio-title">{title}</span>
          <div className="audio-actions">
            {onDownload && (
              <button className="audio-btn" onClick={onDownload} title={t('common:actions.download')}>
                ⬇️
              </button>
            )}
            {onClose && (
              <button className="audio-btn" onClick={onClose} title={t('common:close')}>
                ×
              </button>
            )}
          </div>
        </div>
      )}

      <div className="audio-player-controls">
        <button
          className="control-btn play-pause"
          onClick={isPlaying ? onPause : onPlay}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <div className="progress-container">
          <span className="time-display">{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration}
            value={currentTime}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="progress-bar"
          />
          <span className="time-display">{formatTime(duration)}</span>
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
  )
}
