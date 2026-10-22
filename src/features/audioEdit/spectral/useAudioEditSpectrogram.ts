import { useEffect, useRef, useState } from 'react'
import type { SpectrogramData } from '@/core/audio/spectrogram'
import type { AudioEditSpectrogramChunk } from '@/core/audioEdit/regions'
import { joinSpectrogramChunks, planSpectrogramTiles, spectrogramOverviewHop, SpectrogramTileLru, SPECTROGRAM_FFT_SIZE, SPECTROGRAM_WINDOW_SIZE } from '@/core/audioEdit/spectrogramTiles'
import { createLogger } from '@/core/logging'
import { getAudioEditSpectrogram } from '../application/audioEditRegions'
import type { WaveformViewport } from '../waveformViewport'

const logger = createLogger('features.audioEdit.spectrogram')
export interface AudioEditSpectrogramState { data?: SpectrogramData; status: 'idle' | 'loading' | 'ready' | 'error'; error?: string; retry: () => void }

/** 总览固定精度，其余按像素选二次幂 hop；左右各预取半屏并对齐固定块。 */
export function planSpectrogramRequest(view: WaveformViewport, columns: number, duration: number): { startFrame: number; endFrame: number; hop: number } {
  const span = Math.max(1, view.end - view.start)
  const hop = span >= duration * 0.9 ? spectrogramOverviewHop(duration)
    : Math.min(1 << 24, Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, span / Math.max(64, columns))))))
  const tiles = planSpectrogramTiles(Math.max(0, view.start - span / 2), Math.min(duration, view.end + span / 2), duration, hop)
  return { startFrame: tiles[0]?.startFrame ?? 0, endFrame: tiles[tiles.length - 1]?.endFrame ?? duration, hop }
}

export function chunkToSpectrogram(chunks: readonly AudioEditSpectrogramChunk[]): SpectrogramData {
  const chunk = joinSpectrogramChunks(chunks)
  // STFT 列以采样帧为中心，显示时左移半个间隔。
  const startFrame = chunk.startFrame - chunk.hop / 2
  const padTail = startFrame + chunk.timeBins * chunk.hop < chunk.endFrame
  const frameCount = chunk.timeBins + (padTail ? 1 : 0)
  let values = chunk.values
  if (padTail) {
    // 左移后末尾最多有半个 hop 未覆盖，不能把这段有效音频画成黑竖条。
    // 只在所有块拼好后延展最后一列；内部接缝始终使用相邻块的真实列。
    const size = chunk.timeBins * chunk.frequencyBins
    values = new Uint8Array(frameCount * chunk.frequencyBins * chunk.channels)
    for (let channel = 0; channel < chunk.channels; channel++) {
      const target = channel * frameCount * chunk.frequencyBins
      values.set(chunk.values.subarray(channel * size, (channel + 1) * size), target)
      values.set(chunk.values.subarray((channel + 1) * size - chunk.frequencyBins, (channel + 1) * size), target + size)
    }
  }
  return { sampleRate: chunk.sampleRate, fftSize: chunk.fftSize, hop: chunk.hop, startFrame, frameCount, binCount: chunk.frequencyBins, channelCount: chunk.channels, values }
}

/** 后端可能因声道数拆小块；只保留当前逻辑块的列，防止拼接重复边缘。 */
function clipChunk(chunk: AudioEditSpectrogramChunk, start: number, end: number): AudioEditSpectrogramChunk {
  const first = Math.max(0, Math.round((start - chunk.startFrame) / chunk.hop))
  const last = Math.min(chunk.timeBins, Math.ceil((end - chunk.startFrame) / chunk.hop))
  if (first === 0 && last === chunk.timeBins) return chunk
  const timeBins = last - first, values = new Uint8Array(timeBins * chunk.frequencyBins * chunk.channels)
  for (let channel = 0; channel < chunk.channels; channel++) {
    const base = channel * chunk.timeBins * chunk.frequencyBins
    values.set(chunk.values.subarray(base + first * chunk.frequencyBins, base + last * chunk.frequencyBins), channel * timeBins * chunk.frequencyBins)
  }
  return { ...chunk, startFrame: chunk.startFrame + first * chunk.hop, endFrame: Math.min(end, chunk.endFrame), timeBins, values }
}

export function useAudioEditSpectrogram(projectId: string, view: WaveformViewport, columns: number, duration: number, mode: 'source' | 'edited', revision: number): AudioEditSpectrogramState {
  const [state, setState] = useState<Omit<AudioEditSpectrogramState, 'retry'>>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const [stableColumns, setStableColumns] = useState(columns)
  const covered = useRef<{ key: string; startFrame: number; endFrame: number; hop: number } | null>(null)
  const displayedProject = useRef(projectId)
  const key = `${projectId}|${mode}|${mode === 'edited' ? revision : ''}|${attempt}|${duration}`
  const cache = useRef({ key, tiles: new SpectrogramTileLru(), running: new Map<string, Promise<AudioEditSpectrogramChunk>>() })
  if (cache.current.key !== key) cache.current = { key, tiles: new SpectrogramTileLru(), running: new Map() }
  const store = cache.current

  useEffect(() => {
    const timer = window.setTimeout(() => setStableColumns(columns), 150)
    return () => window.clearTimeout(timer)
  }, [columns])

  const loadTile = async (startFrame: number, endFrame: number, hop: number): Promise<AudioEditSpectrogramChunk> => {
    const tileKey = `${hop}|${startFrame}|${endFrame}`
    const held = store.tiles.get(tileKey)
    if (held) return held
    const running = store.running.get(tileKey)
    if (running) return running
    const operation = (async () => {
      const chunks: AudioEditSpectrogramChunk[] = []
      let start = startFrame
      while (start < endFrame) {
        const chunk = await getAudioEditSpectrogram({ projectId, startFrame: start, endFrame, mode, fftSize: SPECTROGRAM_FFT_SIZE, windowSize: SPECTROGRAM_WINDOW_SIZE, timePooling: true, hop })
        if (chunk.endFrame <= start || chunk.startFrame > start) throw new Error('频谱块没有覆盖请求范围')
        chunks.push(clipChunk(chunk, start, endFrame))
        start = chunk.endFrame
      }
      const result = joinSpectrogramChunks(chunks)
      store.tiles.set(tileKey, result)
      return result
    })()
    store.running.set(tileKey, operation)
    try { return await operation } finally { store.running.delete(tileKey) }
  }

  // 首次打开即预热整段总览；与当前视口共用在途请求及固定块，失败不覆盖正在显示的数据。
  useEffect(() => {
    let cancelled = false
    if (duration <= 0) return
    const timer = window.setTimeout(() => void (async () => {
      try {
        const hop = spectrogramOverviewHop(duration)
        for (const tile of planSpectrogramTiles(0, duration, duration, hop)) {
          if (cancelled) return
          await loadTile(tile.startFrame, tile.endFrame, hop)
        }
      } catch (error) {
        if (!cancelled) logger.warn('频谱总览预热失败', { event: 'audio_edit.spectrogram.overview.failed', error })
      }
    })(), 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key 包含素材、模式、编辑版本和重试代次
  }, [key])

  const plan = duration > 0 && stableColumns > 0 ? planSpectrogramRequest(view, stableColumns, duration) : null
  const held = covered.current
  const reuse = plan && held && held.key === key && held.hop === plan.hop && held.startFrame <= Math.max(0, view.start) && held.endFrame >= Math.min(duration, view.end)
  const request = plan && !reuse ? `${key}|${plan.startFrame}|${plan.endFrame}|${plan.hop}` : ''
  useEffect(() => {
    if (!plan || !request) return
    let cancelled = false
    const keepPrevious = displayedProject.current === projectId
    displayedProject.current = projectId
    setState(previous => ({ ...(keepPrevious ? previous : {}), status: 'loading', error: undefined }))
    void (async () => {
      try {
        const chunks: AudioEditSpectrogramChunk[] = []
        for (const tile of planSpectrogramTiles(plan.startFrame, plan.endFrame, duration, plan.hop)) {
          if (cancelled) return
          chunks.push(await loadTile(tile.startFrame, tile.endFrame, plan.hop))
        }
        if (cancelled || !chunks.length) return
        covered.current = { key, startFrame: chunks[0].startFrame, endFrame: chunks[chunks.length - 1].endFrame, hop: plan.hop }
        setState({ data: chunkToSpectrogram(chunks), status: 'ready' })
      } catch (error) {
        if (!cancelled) setState(previous => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : '频谱图没有生成出来。' }))
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- request 编码完整计划；视口仍被覆盖时保持原数据引用
  }, [request])

  return { ...state, retry: () => { covered.current = null; setAttempt(value => value + 1) } }
}
