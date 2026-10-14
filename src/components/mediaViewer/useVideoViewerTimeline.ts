import { useCallback, useEffect, useRef, useState } from 'react'

export interface VideoViewerTimeline {
  duration: number
  segments: Array<{ videoUrl: string; filePath?: string; start: number; end: number; sourceStart: number }>
}
export interface VideoViewerSeek { seconds: number; request: number }
interface TimelinePlayer {
  segment: VideoViewerTimeline['segments'][number] | undefined
  currentTime: number; playing: boolean; buffering: boolean; gap: boolean
  seek: (seconds: number) => void; togglePlay: () => void; loaded: () => void; ended: () => void; failed: () => void
  setBuffering: React.Dispatch<React.SetStateAction<boolean>>
}

/** Adapts timed files to the existing viewer. Media time drives playback; only empty gaps use wall time. */
export function useVideoViewerTimeline(timeline: VideoViewerTimeline | undefined, videoRef: React.RefObject<HTMLVideoElement>, open: boolean, playbackRate: number, loop: boolean, seekRequest?: VideoViewerSeek): TimelinePlayer {
  const [index, setIndex] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const position = useRef(0)
  const activeIndex = useRef(0)
  const playingRef = useRef(false)
  const pending = useRef<number | null>(0)
  const gapClock = useRef({ time: 0, wall: 0 })
  const playVersion = useRef(0)
  const playMedia = useCallback((): void => {
    const version = playVersion.current
    void videoRef.current?.play().catch(() => {
      // Changing source/track can reject an earlier play() after a new one has already started.
      if (version !== playVersion.current) return
      playingRef.current = false
      setPlaying(false)
      setBuffering(false)
    })
  }, [videoRef])
  const seek = useCallback((seconds: number): void => {
    if (!timeline) return
    playVersion.current += 1
    const next = Math.max(0, Math.min(seconds, timeline.duration))
    const target = timeline.segments.findIndex(segment => segment.start <= next && next < segment.end)
    position.current = next
    setCurrentTime(next)
    gapClock.current = { time: next, wall: performance.now() }
    activeIndex.current = target
    setIndex(target)
    const video = videoRef.current
    if (target < 0) {
      pending.current = null
      video?.pause()
      setBuffering(false)
    } else {
      const segment = timeline.segments[target]
      pending.current = segment.sourceStart + next - segment.start
      if (video && video.getAttribute('src') === segment.videoUrl && video.readyState >= 1) {
        video.currentTime = pending.current
        pending.current = null
        if (playingRef.current) playMedia()
      } else setBuffering(playingRef.current)
    }
  }, [timeline, videoRef, playMedia])
  useEffect(() => () => { playVersion.current += 1; playingRef.current = false }, [])
  useEffect(() => {
    playingRef.current = false
    setPlaying(false)
    videoRef.current?.pause()
    seek(0)
  }, [timeline, open, seek, videoRef])
  useEffect(() => { if (open && seekRequest) seek(seekRequest.seconds) }, [open, seek, seekRequest])
  useEffect(() => {
    if (!timeline || !open || !playing) return
    let frame = 0
    gapClock.current = { time: position.current, wall: performance.now() }
    const tick = (): void => {
      if (!playingRef.current) return
      if (activeIndex.current < 0) {
        const next = gapClock.current.time + (performance.now() - gapClock.current.wall) / 1000 * playbackRate
        if (next >= timeline.duration) {
          if (loop) seek(0)
          else { playingRef.current = false; setPlaying(false); seek(timeline.duration) }
        } else {
          const nextSegment = timeline.segments.find(segment => segment.start >= position.current && segment.start <= next)
          if (nextSegment) seek(nextSegment.start)
          else { position.current = next; setCurrentTime(next) }
        }
      } else {
        const segment = timeline.segments[activeIndex.current]
        const video = videoRef.current
        if (segment && video && pending.current === null && !video.seeking && !video.paused) {
          const next = segment.start + video.currentTime - segment.sourceStart
          if (next >= segment.end) seek(segment.end)
          else { position.current = next; setCurrentTime(next) }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [loop, open, playbackRate, playing, seek, timeline, videoRef])
  useEffect(() => { if (!open) { playingRef.current = false; setPlaying(false) } }, [open])
  const togglePlay = (): void => {
    if (!timeline) return
    playingRef.current = !playingRef.current
    setPlaying(playingRef.current)
    if (!playingRef.current) { playVersion.current += 1; videoRef.current?.pause(); return }
    seek(position.current >= timeline.duration ? 0 : position.current)
  }
  const loaded = (): void => {
    const video = videoRef.current
    if (!video || !timeline || activeIndex.current < 0) return
    const segment = timeline.segments[activeIndex.current]
    video.currentTime = pending.current ?? segment.sourceStart + position.current - segment.start
    pending.current = null
    setBuffering(false)
    if (playingRef.current) playMedia()
  }
  const ended = (): void => {
    if (!timeline || activeIndex.current < 0) return
    const end = timeline.segments[activeIndex.current].end
    if (end >= timeline.duration && !loop) { playingRef.current = false; setPlaying(false); seek(timeline.duration) }
    else seek(end >= timeline.duration ? 0 : end)
  }
  const failed = (): void => { playVersion.current += 1; playingRef.current = false; setPlaying(false); setBuffering(false) }
  return { segment: timeline?.segments[index], currentTime, playing, buffering, gap: index < 0, seek, togglePlay, loaded, ended, failed, setBuffering }
}
