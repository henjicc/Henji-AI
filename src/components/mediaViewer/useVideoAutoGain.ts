import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/core/logging'

const logger = createLogger('components.mediaViewer.autoGain')
/** Kept for this run of the app: turning it on once applies to every video opened afterwards. */
let rememberedEnabled = false

interface AudioChain { context: AudioContext; source: MediaElementAudioSourceNode; input: AudioNode; output: AudioNode }

/**
 * Playback-only loudness evening for the video viewer: a compressor lifts quiet speech and a limiter
 * keeps loud parts from clipping. The file is untouched. Web Audio needs the media loaded with CORS, so
 * turning it on reloads the video at the same moment; a source that refuses CORS turns it off with a reason.
 */
export function useVideoAutoGain(videoRef: React.RefObject<HTMLVideoElement>, sourceUrl: string, unavailableReason: string): {
  enabled: boolean; unavailable?: string; crossOrigin: 'anonymous' | undefined
  setEnabled(next: boolean): void; loaded(): void; failed(): boolean; playing(): void
} {
  const [enabled, setEnabledState] = useState(rememberedEnabled)
  const [blocked, setBlocked] = useState(false)
  const [wired, setWired] = useState(false)
  const chain = useRef<AudioChain | null>(null)
  const restore = useRef<{ time: number; playing: boolean } | null>(null)
  const crossOrigin = (enabled || wired) && !blocked ? 'anonymous' : undefined

  useEffect(() => { setBlocked(false) }, [sourceUrl])
  useEffect(() => () => { void chain.current?.context.close().catch(() => undefined); chain.current = null }, [])

  const route = useCallback((on: boolean): void => {
    const current = chain.current
    if (!current) return
    current.source.disconnect()
    current.source.connect(on ? current.input : current.context.destination)
  }, [])

  const wire = useCallback((): void => {
    const video = videoRef.current
    if (chain.current || !video || video.crossOrigin !== 'anonymous') return
    try {
      const context = new AudioContext()
      const source = context.createMediaElementSource(video)
      const compressor = new DynamicsCompressorNode(context, { threshold: -42, knee: 24, ratio: 5, attack: 0.005, release: 0.3 })
      const makeup = new GainNode(context, { gain: 4 })
      const limiter = new DynamicsCompressorNode(context, { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.1 })
      compressor.connect(makeup).connect(limiter).connect(context.destination)
      chain.current = { context, source, input: compressor, output: limiter }
      setWired(true)
    } catch (error) {
      logger.warn('自动增益不可用', { event: 'video_viewer.auto_gain.unavailable', error: String(error) })
      setBlocked(true)
    }
  }, [videoRef])

  // Turning it on for a video loaded without CORS: reload it with CORS at the same moment.
  useEffect(() => {
    const video = videoRef.current
    if (!video || blocked) return
    if (enabled && !chain.current && video.readyState > 0 && video.crossOrigin === 'anonymous' && !restore.current) {
      restore.current = { time: video.currentTime, playing: !video.paused }
      video.load()
      return
    }
    route(enabled)
  }, [enabled, blocked, crossOrigin, route, videoRef])

  return {
    enabled, crossOrigin,
    ...(blocked ? { unavailable: unavailableReason } : {}),
    setEnabled: next => { rememberedEnabled = next; setEnabledState(next) },
    loaded: () => {
      const video = videoRef.current
      if (!video) return
      const pending = restore.current
      restore.current = null
      if (pending) {
        video.currentTime = pending.time
        if (pending.playing) void video.play().catch(() => undefined)
      }
      if (enabled) { wire(); route(true) }
    },
    failed: () => {
      const video = videoRef.current
      if (!video || video.crossOrigin !== 'anonymous' || blocked) return false
      // The source refuses CORS: play it as before, without auto gain.
      logger.warn('视频来源不允许跨域处理声音，自动增益已关闭', { event: 'video_viewer.auto_gain.blocked' })
      restore.current = { time: video.currentTime, playing: !video.paused }
      setBlocked(true)
      queueMicrotask(() => videoRef.current?.load())
      return true
    },
    playing: () => { void chain.current?.context.resume().catch(() => undefined) },
  }
}
