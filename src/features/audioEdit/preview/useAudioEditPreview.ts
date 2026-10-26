import { useCallback, useEffect, useMemo, useRef } from 'react'
import { readAudioEditViewMemory } from '../workspace/audioEditViewMemory'

import { buildProjectAudioEditTimeline, editedDurationFrames, findTranscriptBlockForPlayback, nextRetainedSourceFrame, sourceFrameToOutputFrame } from '@/core/audioEdit/timeline'
import { compileAudioEditXmlTimeline } from '@/core/audioEdit/xml'
import { audioEditRealtimeEffects } from '@/core/audioEdit/effects'
import { audioEditSourceRecipe } from '@/core/audioEdit/regions'
import { AudioEffectChain, type AudioEffectInstance } from '@/core/audio/effects/audioEffectChain'
import type { AudioEditPreviewMode, AudioEditProjectDocument, AudioEditTimelineSpan } from '@/core/audioEdit/types'
import { createLogger } from '@/core/logging'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { createPreviewOutput } from './previewGain'
import { PreviewChunkCache } from './previewChunkCache'
import { bindAudioEditScrub, createScrubScheduler } from './audioEditScrub'

const CHUNK_SECONDS = 1
const BUFFER_SECONDS = 3
/** 有实时效果（基本声音、效果组）时只提前处理很短一段：拖动效果参数约 0.3 秒内就能听到。 */
const EFFECT_CHUNK_SECONDS = 0.1
const EFFECT_BUFFER_SECONDS = 0.35
const EFFECT_LOW_WATER_SECONDS = 0.22
const logger = createLogger('features.audioEdit.preview')

interface WorkletMessage {
  type: 'position' | 'need-data' | 'starved'
  sourceFrame?: number
  generation: number
  consumedFrames?: number
}

function playbackSpans(project: AudioEditProjectDocument, mode: AudioEditPreviewMode): AudioEditTimelineSpan[] {
  if (mode === 'delivery') {
    try { return compileAudioEditXmlTimeline(project).spans } catch { return [] }
  }
  return mode === 'source'
    ? [{ sourceStartFrame: 0, sourceEndFrame: project.source.durationFrames, outputStartFrame: 0, outputEndFrame: project.source.durationFrames }]
    : buildProjectAudioEditTimeline(project)
}

/** 交错 PCM 原地过效果链（拆成逐声道处理再交错回去）。 */
function processInterleaved(chain: AudioEffectChain, pcm: Float32Array, channels: number, frames: number): void {
  const planar = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) planar[channel][frame] = pcm[frame * channels + channel]
  chain.process(planar, frames)
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) pcm[frame * channels + channel] = planar[channel][frame]
}

export function useAudioEditPreview(project: AudioEditProjectDocument | null, normalizationGain = 1) {
  const contextRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const outputRef = useRef<ReturnType<typeof createPreviewOutput> | null>(null)
  const autoGain = useAudioEditPlaybackStore((state) => state.autoGain)
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const volume = useAudioEditPlaybackStore((state) => state.volume)
  const levelsRef = useRef({ gain: 1, volume, bypass: false })
  levelsRef.current = { gain: autoGain && mode !== 'delivery' ? normalizationGain : 1, volume, bypass: mode === 'delivery' }
  useEffect(() => { outputRef.current?.setLevels(levelsRef.current.gain, volume, mode === 'delivery') }, [autoGain, normalizationGain, volume, mode])
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
  const scrubDirtyRef = useRef(false)
  const cancelScrubRef = useRef<() => void>(() => undefined)
  const resumeRef = useRef<Promise<void> | null>(null)
  const activeSpans = useMemo(() => project ? playbackSpans(project, mode) : [], [mode, project])
  const timeline = activeSpans
  // 编辑后声音变了（修复、效果链里整段处理的那一段、区间音量；只换 id 不算）才换缓存从当前位置重来。
  const planKey = JSON.stringify([project?.id, project?.source, mode, project && mode !== 'source' ? audioEditSourceRecipe(project) : undefined, activeSpans])
  const cacheRef = useRef<{ key: string; value: PreviewChunkCache } | null>(null)
  if (project && cacheRef.current?.key !== planKey) cacheRef.current = { key: planKey, value: new PreviewChunkCache(project, mode, activeSpans) }
  const cache = project ? cacheRef.current!.value : null
  // 边播边算的部分（效果链末尾的实时效果 + 输出）：“原始”试听不加效果（用来对比）；结构变了（增删、换序、开关）就清空排队的声音
  // 从当前位置重来，只改参数时原地生效。
  const effects = useMemo<AudioEffectInstance[]>(() => project && mode !== 'source' ? audioEditRealtimeEffects(project) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the effect-related fields matter
    [project?.effectChain, project?.chainBypassed, project?.output, mode])
  const effectsRef = useRef(effects)
  effectsRef.current = effects
  const chainRef = useRef<AudioEffectChain | null>(null)
  const chainResetRef = useRef(true)
  const effectStructure = effects.map(effect => `${effect.id}:${effect.builtin.id}`).join('|')

  const resolveFrame = useCallback((requestedFrame: number) => {
    if (!project) return 0
    const next = mode === 'source'
      ? Math.max(0, Math.min(project.source.durationFrames, requestedFrame))
      : nextRetainedSourceFrame(requestedFrame, timeline)
    return requestedFrame === 0 && mode === 'delivery' ? timeline[0]?.sourceStartFrame ?? 0 : next ?? timeline.at(-1)?.sourceEndFrame ?? project.source.durationFrames
  }, [mode, project, timeline])
  const resolveFrameRef = useRef(resolveFrame)
  resolveFrameRef.current = resolveFrame

  const resume = useCallback(() => {
    const context = contextRef.current
    if (!context || context.state !== 'suspended') return Promise.resolve()
    // 不在暂停时挂起设备；同一设备只保留一个恢复请求，完成后不反写播放意图。
    if (!resumeRef.current) {
      const pending = context.resume()
      resumeRef.current = pending
      void pending.finally(() => { if (resumeRef.current === pending) resumeRef.current = null }).catch(() => undefined)
    }
    return resumeRef.current
  }, [])

  const publishPosition = useCallback((sourceFrame: number) => {
    if (!project) return
    const outputFrame = mode === 'source' ? sourceFrame : sourceFrameToOutputFrame(sourceFrame, timeline) ?? (sourceFrame >= (timeline.at(-1)?.sourceEndFrame ?? 0) ? editedDurationFrames(timeline) : 0)
    const block = findTranscriptBlockForPlayback(sourceFrame, project.transcript, mode === 'source', project.source.sampleRate / 4)
    useAudioEditPlaybackStore.getState().updatePosition(sourceFrame, outputFrame, block?.id ?? null)
  }, [mode, project, timeline])
  publishPositionRef.current = publishPosition

  const fillBuffer = useCallback(async () => {
    const node = nodeRef.current
    if (!node || !project || !cache || scrubDirtyRef.current) return
    if (fillingPromiseRef.current) return fillingPromiseRef.current
    const generation = generationRef.current
    const filling = (async () => {
      try {
        const realtime = effectsRef.current.length > 0
        while (queuedFramesRef.current < project.source.sampleRate * (realtime ? EFFECT_BUFFER_SECONDS : BUFFER_SECONDS) && generation === generationRef.current) {
          const cursor = nextSourceFrameRef.current
          const chunk = await cache.read(cursor, Math.round(project.source.sampleRate * (realtime ? EFFECT_CHUNK_SECONDS : CHUNK_SECONDS)))
          if (generation !== generationRef.current) break
          if (!chunk) {
            endedRef.current = true
            if (queuedFramesRef.current === 0) {
              playingRef.current = false
              node.port.postMessage({ type: 'playing', value: false })
              useAudioEditPlaybackStore.getState().setPlaying(false)
            }
            break
          }
          const decodedFrames = chunk.sourceEndFrame - chunk.sourceStartFrame
          if (decodedFrames <= 0) throw new Error('此位置无法读取音频，请重新定位后重试')
          const live = effectsRef.current
          if (live.length && chainRef.current) {
            const chain = chainRef.current
            if (chainResetRef.current) {
              await chain.reset(live); chainResetRef.current = false
              // 调制效果的振荡相位按剪后时间对齐，与从头导出的同一位置一致。
              chain.locate(sourceFrameToOutputFrame(chunk.sourceStartFrame, timeline) ?? 0)
            } else await chain.sync(live)
            if (generation !== generationRef.current) break
            processInterleaved(chain, new Float32Array(chunk.pcm), chunk.channels, decodedFrames)
          }
          queuedFramesRef.current += decodedFrames
          enqueuedFramesRef.current += decodedFrames
          nextSourceFrameRef.current = chunk.sourceEndFrame
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
  }, [project, cache, timeline])
  fillBufferRef.current = fillBuffer

  const resetAt = useCallback((requestedFrame: number) => {
    if (!project || !nodeRef.current) return
    cancelScrubRef.current()
    scrubDirtyRef.current = false
    const target = resolveFrame(requestedFrame)
    generationRef.current += 1
    queuedFramesRef.current = 0
    enqueuedFramesRef.current = 0
    endedRef.current = false
    chainResetRef.current = true
    nextSourceFrameRef.current = target
    nodeRef.current.port.postMessage({ type: 'reset', generation: generationRef.current })
    publishPosition(target)
    useAudioEditPlaybackStore.getState().setError(null)
    useAudioEditPlaybackStore.getState().setPreparing(true)
    void fillBuffer()
  }, [fillBuffer, project, publishPosition, resolveFrame])
  resetAtRef.current = resetAt

  const projectId = project?.id
  const sampleRate = project?.source.sampleRate
  const channelCount = project?.source.channels
  const durationRef = useRef(project?.source.durationFrames ?? 0)
  durationRef.current = project?.source.durationFrames ?? 0
  const openedProject = useRef<string>()

  useEffect(() => {
    if (!projectId || !sampleRate || !channelCount) return
    // 打开另一份口播时回到它上次停的位置（没有记录就从头）
    if (openedProject.current !== projectId) useAudioEditPlaybackStore.getState().updatePosition(readAudioEditViewMemory(projectId, durationRef.current)?.playhead ?? 0, 0, null)
    openedProject.current = projectId
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
        chainRef.current?.dispose()
        chainRef.current = new AudioEffectChain(sampleRate, channelCount)
        chainResetRef.current = true
        const output = createPreviewOutput(context)
        output.setLevels(levelsRef.current.gain, levelsRef.current.volume, levelsRef.current.bypass)
        node.connect(output.input)
        outputRef.current = output
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
        resetAtRef.current(useAudioEditPlaybackStore.getState().sourceFrame)
      } catch (error) {
        logger.error('audio_edit.preview.initialize.failed', error)
        useAudioEditPlaybackStore.getState().setError(error instanceof Error ? error.message : '预览引擎初始化失败')
        useAudioEditPlaybackStore.getState().setPreparing(false)
      }
    })()
    return () => {
      disposed = true
      cancelScrubRef.current()
      scrubDirtyRef.current = false
      resumeRef.current = null
      generationRef.current += 1
      nodeRef.current?.disconnect()
      chainRef.current?.dispose()
      chainRef.current = null
      outputRef.current?.dispose()
      outputRef.current = null
      void contextRef.current?.close()
      nodeRef.current = null
      contextRef.current = null
      playingRef.current = false
      useAudioEditPlaybackStore.setState({ playing: false, ready: false })
    }
  }, [channelCount, projectId, sampleRate])

  useEffect(() => {
    if (!nodeRef.current) return
    resetAtRef.current(useAudioEditPlaybackStore.getState().sourceFrame)
    // 仅保存版本或选区变化不使音频缓存失效。
  }, [planKey])

  // 有无实时效果决定工作线程多早要数据；效果结构变了，丢掉已按旧效果处理好的排队声音，从当前位置重新处理。
  const realtime = effects.length > 0
  useEffect(() => {
    nodeRef.current?.port.postMessage({ type: 'config', lowWaterFrames: Math.round((sampleRate ?? 48000) * (realtime ? EFFECT_LOW_WATER_SECONDS : 1.5)) })
  }, [realtime, sampleRate])
  const appliedStructure = useRef(effectStructure)
  useEffect(() => {
    if (appliedStructure.current === effectStructure) return
    appliedStructure.current = effectStructure
    if (nodeRef.current && playingRef.current) resetAtRef.current(useAudioEditPlaybackStore.getState().sourceFrame)
    else chainResetRef.current = true
  }, [effectStructure])

  const togglePlayback = useCallback(async () => {
    const context = contextRef.current
    const node = nodeRef.current
    if (!context || !node) return
    if (playingRef.current) {
      playingRef.current = false
      node.port.postMessage({ type: 'playing', value: false })
      useAudioEditPlaybackStore.getState().setPlaying(false)
      return
    }
    if (!project) return
    if (scrubDirtyRef.current) resetAtRef.current(useAudioEditPlaybackStore.getState().sourceFrame)
    else if (endedRef.current && queuedFramesRef.current === 0) resetAtRef.current(0)
    cancelScrubRef.current()
    playingRef.current = true
    node.port.postMessage({ type: 'playing', value: true })
    useAudioEditPlaybackStore.getState().setError(null)
    useAudioEditPlaybackStore.getState().setPlaying(true)
    try { await resume() } catch (error) {
      if (contextRef.current !== context || !playingRef.current) return
      logger.error('audio_edit.preview.resume.failed', error)
      playingRef.current = false
      node.port.postMessage({ type: 'playing', value: false })
      useAudioEditPlaybackStore.setState({ playing: false, preparing: false, error: '音频设备未能恢复，请重试播放' })
      return
    }
    if (contextRef.current !== context || !playingRef.current) return
    if (queuedFramesRef.current < project.source.sampleRate / 4) {
      useAudioEditPlaybackStore.getState().setPreparing(true)
      await fillBufferRef.current()
    }
    void fillBufferRef.current()
  }, [project, resume])

  useEffect(() => {
    if (!projectId || !cache) return
    let active = true
    const failed = (error: unknown) => {
      logger.error('audio_edit.preview.scrub.failed', error)
      useAudioEditPlaybackStore.getState().setError(error instanceof Error ? error.message : '擦洗试听失败，请重试')
    }
    const scheduler = createScrubScheduler(async frame => {
      const generation = generationRef.current
      const [grain] = await Promise.all([cache.grain(frame), resume()])
      return { ...grain, generation }
    }, grain => {
      if (!active || playingRef.current || grain.generation !== generationRef.current) return
      nodeRef.current?.port.postMessage({ type: 'scrub', ...grain }, [grain.pcm])
      useAudioEditPlaybackStore.getState().setError(null)
    }, failed)
    cancelScrubRef.current = () => { scheduler.cancel(); nodeRef.current?.port.postMessage({ type: 'scrub-stop' }) }
    const move = (frame: number) => {
      if (playingRef.current) { resetAtRef.current(frame); return }
      if (!nodeRef.current) return
      const target = resolveFrameRef.current(frame)
      if (!scrubDirtyRef.current) {
        scrubDirtyRef.current = true
        generationRef.current += 1
        nodeRef.current.port.postMessage({ type: 'reset', generation: generationRef.current })
        queuedFramesRef.current = 0
        enqueuedFramesRef.current = 0
        useAudioEditPlaybackStore.getState().setPreparing(false)
      }
      publishPositionRef.current(target)
      scheduler.request(target)
    }
    const unbind = bindAudioEditScrub(projectId, {
      start(frame) {
        logger.debug('audio_edit.preview.scrub.start', { projectId })
        if (!playingRef.current) void cache.prefetch(resolveFrameRef.current(frame)).catch(error => {
          // 邻近预取是可选加速；实际试听读取失败才提示用户，不能由过期预取覆盖当前状态。
          if (active) logger.debug('audio_edit.preview.prefetch.failed', { projectId, message: error instanceof Error ? error.message : String(error) })
        })
      },
      move,
      step: move,
      end() {
        logger.debug('audio_edit.preview.scrub.completed', { projectId })
        if (scrubDirtyRef.current) resetAtRef.current(useAudioEditPlaybackStore.getState().sourceFrame)
      },
    })
    return () => { active = false; scheduler.cancel(); unbind() }
  }, [cache, projectId, resume])

  return { timeline, togglePlayback, seekSourceFrame: resetAt }
}
