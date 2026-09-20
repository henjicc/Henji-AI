import { useCallback, useEffect, useMemo, useRef } from 'react'

import { buildAudioEditTimeline, editedDurationFrames, findTranscriptBlockForPlayback, nextRetainedSourceFrame, sourceFrameToOutputFrame } from '@/core/audioEdit/timeline'
import type { AudioEditProjectDocument, AudioEditTimelineSpan } from '@/core/audioEdit/types'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'

const CHUNK_SECONDS = 1
const BUFFER_SECONDS = 3
const logger = createLogger('features.audioEdit.preview')

interface WorkletMessage {
  type: 'position' | 'need-data' | 'starved'
  sourceFrame?: number
  generation: number
  consumedFrames?: number
}

function playbackSpans(project: AudioEditProjectDocument, mode: 'edited' | 'source'): AudioEditTimelineSpan[] {
  return mode === 'source'
    ? [{ sourceStartFrame: 0, sourceEndFrame: project.source.durationFrames, outputStartFrame: 0, outputEndFrame: project.source.durationFrames }]
    : buildAudioEditTimeline(project.source.durationFrames, project.transcript)
}

export function useAudioEditPreview(project: AudioEditProjectDocument | null) {
  const contextRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const generationRef = useRef(0)
  const nextSourceFrameRef = useRef(0)
  const fillingPromiseRef = useRef<Promise<void> | null>(null)
  const fillBufferRef = useRef<() => Promise<void>>(async () => undefined)
  const publishPositionRef = useRef<(sourceFrame: number) => void>(() => undefined)
  const resetAtRef = useRef<(sourceFrame: number) => void>(() => undefined)
  const queuedFramesRef = useRef(0)
  const enqueuedFramesRef = useRef(0)
  const endedRef = useRef(false)
  const playingRef = useRef(false)
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const durationFrames = project?.source.durationFrames ?? 0
  const transcript = project?.transcript
  const timeline = useMemo(() => buildAudioEditTimeline(durationFrames, transcript ?? []), [durationFrames, transcript])
  const activeSpans = useMemo(() => project ? playbackSpans(project, mode) : [], [mode, project])
  const spansRef = useRef(activeSpans)
  spansRef.current = activeSpans

  const publishPosition = useCallback((sourceFrame: number) => {
    if (!project) return
    const outputFrame = mode === 'source' ? sourceFrame : sourceFrameToOutputFrame(sourceFrame, timeline) ?? (sourceFrame >= (timeline.at(-1)?.sourceEndFrame ?? 0) ? editedDurationFrames(timeline) : 0)
    const block = findTranscriptBlockForPlayback(sourceFrame, project.transcript, mode === 'source', project.source.sampleRate / 4)
    useAudioEditPlaybackStore.getState().updatePosition(sourceFrame, outputFrame, block?.id ?? null)
  }, [mode, project, timeline])
  publishPositionRef.current = publishPosition

  const fillBuffer = useCallback(async () => {
    const node = nodeRef.current
    if (!node || !project) return
    if (fillingPromiseRef.current) return fillingPromiseRef.current
    const generation = generationRef.current
    const filling = (async () => {
      try {
        while (queuedFramesRef.current < project.source.sampleRate * BUFFER_SECONDS && generation === generationRef.current) {
          const cursor = nextSourceFrameRef.current
          const span = spansRef.current.find((candidate) => cursor >= candidate.sourceStartFrame && cursor < candidate.sourceEndFrame)
            ?? spansRef.current.find((candidate) => candidate.sourceStartFrame >= cursor)
          if (!span) {
            endedRef.current = true
            if (queuedFramesRef.current === 0) {
              playingRef.current = false
              node.port.postMessage({ type: 'playing', value: false })
              useAudioEditPlaybackStore.getState().setPlaying(false)
            }
            break
          }
          const startFrame = Math.max(cursor, span.sourceStartFrame)
          const frameCount = Math.min(project.source.sampleRate * CHUNK_SECONDS, span.sourceEndFrame - startFrame)
          const chunk = await getPlatform().audioEdit.preparePreviewChunk({ projectId: project.id, sourceStartFrame: startFrame, frameCount })
          if (generation !== generationRef.current) break
          const decodedFrames = chunk.sourceEndFrame - chunk.sourceStartFrame
          if (decodedFrames <= 0) throw new Error('此位置无法读取音频，请重新定位后重试')
          queuedFramesRef.current += decodedFrames
          enqueuedFramesRef.current += decodedFrames
          nextSourceFrameRef.current = chunk.sourceEndFrame >= span.sourceEndFrame
            ? spansRef.current.find((candidate) => candidate.sourceStartFrame >= span.sourceEndFrame)?.sourceStartFrame ?? project.source.durationFrames
            : chunk.sourceEndFrame
          node.port.postMessage({ type: 'chunk', generation, pcm: chunk.pcm, channels: chunk.channels, sourceStartFrame: chunk.sourceStartFrame, frameCount: decodedFrames }, [chunk.pcm])
          useAudioEditPlaybackStore.getState().setPreparing(false)
        }
        if (generation === generationRef.current) useAudioEditPlaybackStore.getState().setPreparing(false)
      } catch (error) {
        if (generation !== generationRef.current) return
        logger.error('audio_edit.preview.buffer.failed', error)
        useAudioEditPlaybackStore.getState().setError(error instanceof Error ? error.message : '预览缓冲失败')
        playingRef.current = false
        node.port.postMessage({ type: 'playing', value: false })
        useAudioEditPlaybackStore.setState({ preparing: false, playing: false })
      }
    })()
    fillingPromiseRef.current = filling
    await filling.finally(() => {
      if (fillingPromiseRef.current === filling) fillingPromiseRef.current = null
      if (generation !== generationRef.current && nodeRef.current) void fillBufferRef.current()
    })
  }, [project])
  fillBufferRef.current = fillBuffer

  const resetAt = useCallback((requestedFrame: number) => {
    if (!project || !nodeRef.current) return
    const next = mode === 'source'
      ? Math.max(0, Math.min(project.source.durationFrames, requestedFrame))
      : nextRetainedSourceFrame(requestedFrame, timeline)
    const target = next ?? project.source.durationFrames
    generationRef.current += 1
    queuedFramesRef.current = 0
    enqueuedFramesRef.current = 0
    endedRef.current = false
    nextSourceFrameRef.current = target
    nodeRef.current.port.postMessage({ type: 'reset', generation: generationRef.current })
    publishPosition(target)
    useAudioEditPlaybackStore.getState().setError(null)
    useAudioEditPlaybackStore.getState().setPreparing(true)
    void fillBuffer()
  }, [fillBuffer, mode, project, publishPosition, timeline])
  resetAtRef.current = resetAt

  const projectId = project?.id
  const sampleRate = project?.source.sampleRate
  const channelCount = project?.source.channels

  useEffect(() => {
    if (!projectId || !sampleRate || !channelCount) return
    let disposed = false
    useAudioEditPlaybackStore.getState().setMode('edited')
    useAudioEditPlaybackStore.getState().setReady(false)
    useAudioEditPlaybackStore.getState().setError(null)
    useAudioEditPlaybackStore.getState().setPreparing(true)
    void (async () => {
      try {
        const context = new AudioContext({ sampleRate, latencyHint: 'interactive' })
        await context.audioWorklet.addModule(new URL('./audio-edit-preview-worklet.js', window.location.href).href)
        if (disposed) return void context.close()
        const node = new AudioWorkletNode(context, 'henji-audio-edit-preview', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [Math.min(2, channelCount)] })
        node.connect(context.destination)
        contextRef.current = context
        nodeRef.current = node
        node.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
          const message = event.data
          if (message.generation !== generationRef.current) return
          if (message.consumedFrames !== undefined) queuedFramesRef.current = Math.max(0, enqueuedFramesRef.current - message.consumedFrames)
          if (message.type === 'position' && message.sourceFrame !== undefined && playingRef.current) publishPositionRef.current(message.sourceFrame)
          if (message.type === 'starved') {
            if (endedRef.current && queuedFramesRef.current === 0) {
              playingRef.current = false
              node.port.postMessage({ type: 'playing', value: false })
              useAudioEditPlaybackStore.setState({ playing: false, preparing: false })
            } else if (playingRef.current) useAudioEditPlaybackStore.getState().setPreparing(true)
          }
          if (message.type === 'need-data' || message.type === 'starved') void fillBufferRef.current()
        }
        useAudioEditPlaybackStore.getState().setReady(true)
        resetAtRef.current(0)
      } catch (error) {
        logger.error('audio_edit.preview.initialize.failed', error)
        useAudioEditPlaybackStore.getState().setError(error instanceof Error ? error.message : '预览引擎初始化失败')
        useAudioEditPlaybackStore.getState().setPreparing(false)
      }
    })()
    return () => {
      disposed = true
      generationRef.current += 1
      nodeRef.current?.disconnect()
      void contextRef.current?.close()
      nodeRef.current = null
      contextRef.current = null
      playingRef.current = false
      useAudioEditPlaybackStore.setState({ playing: false, ready: false })
    }
  }, [channelCount, projectId, sampleRate])

  const planKey = JSON.stringify([projectId, mode, project?.vstEnabled, activeSpans])
  useEffect(() => {
    if (!nodeRef.current) return
    resetAtRef.current(useAudioEditPlaybackStore.getState().sourceFrame)
    // Persistence revisions and selection updates do not invalidate audio.
  }, [planKey])

  const togglePlayback = useCallback(async () => {
    const context = contextRef.current
    const node = nodeRef.current
    if (!context || !node) return
    if (playingRef.current) {
      playingRef.current = false
      node.port.postMessage({ type: 'playing', value: false })
      useAudioEditPlaybackStore.getState().setPlaying(false)
      if (context.state === 'running') await context.suspend()
      return
    }
    if (!project) return
    if (endedRef.current && queuedFramesRef.current === 0) resetAtRef.current(0)
    playingRef.current = true
    node.port.postMessage({ type: 'playing', value: true })
    useAudioEditPlaybackStore.getState().setPlaying(true)
    if (context.state === 'suspended') await context.resume()
    if (queuedFramesRef.current < project.source.sampleRate / 4) {
      useAudioEditPlaybackStore.getState().setPreparing(true)
      await fillBuffer()
    }
    void fillBuffer()
  }, [fillBuffer, project])

  return { timeline, togglePlayback, seekSourceFrame: resetAt }
}
