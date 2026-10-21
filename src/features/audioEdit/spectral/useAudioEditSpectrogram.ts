import { useEffect, useRef, useState } from 'react'
import type { SpectrogramData } from '@/core/audio/spectrogram'
import type { AudioEditSpectrogramChunk } from '@/core/audioEdit/regions'
import { getAudioEditSpectrogram } from '../application/audioEditRegions'
import type { WaveformViewport } from '../waveformViewport'

const FFT_SIZE = 2048
const MIN_HOP = 128
/** 视口两侧各多取半屏，平移时不必马上重取。 */
const MARGIN = 0.5
const DEBOUNCE_MS = 120

export interface AudioEditSpectrogramState { data?: SpectrogramData; status: 'idle' | 'loading' | 'ready' | 'error'; error?: string; retry: () => void }

/**
 * 每列一个 STFT 窗口、列间隔按屏幕像素取（缩小看长音频时间隔大于窗口，只抽样不全算），
 * 所以一次请求的数据量与屏幕宽度成正比、与音频长短无关。间隔取 2 的幂，缩放时能复用缓存。
 */
export function planSpectrogramRequest(view: WaveformViewport, columns: number, duration: number): { startFrame: number; endFrame: number; hop: number } {
  const span = Math.max(1, view.end - view.start)
  const target = span / Math.max(64, columns)
  const hop = Math.max(MIN_HOP, 2 ** Math.ceil(Math.log2(Math.max(1, target))))
  const startFrame = Math.max(0, Math.floor((view.start - span * MARGIN) / hop) * hop)
  const endFrame = Math.min(duration, Math.ceil((view.end + span * MARGIN) / hop) * hop)
  return { startFrame, endFrame: Math.max(startFrame + 1, endFrame), hop }
}

export function chunkToSpectrogram(chunks: readonly AudioEditSpectrogramChunk[]): SpectrogramData {
  const first = chunks[0]
  const frameCount = chunks.reduce((total, chunk) => total + chunk.timeBins, 0)
  const values = new Uint8Array(first.channels * frameCount * first.frequencyBins)
  let offset = 0
  for (const chunk of chunks) {
    for (let channel = 0; channel < first.channels; channel++) {
      const size = chunk.timeBins * chunk.frequencyBins
      values.set(chunk.values.subarray(channel * size, (channel + 1) * size), channel * frameCount * first.frequencyBins + offset * first.frequencyBins)
    }
    offset += chunk.timeBins
  }
  // 引擎的第 t 列以 startFrame + t·hop 为中心；栅格化按“列覆盖 [起点, 起点 + hop)”取，所以左移半个间隔。
  return { sampleRate: first.sampleRate, fftSize: first.fftSize, hop: first.hop, startFrame: first.startFrame - first.hop / 2, frameCount, binCount: first.frequencyBins, channelCount: first.channels, values }
}

export function useAudioEditSpectrogram(projectId: string, view: WaveformViewport, columns: number, duration: number, mode: 'source' | 'edited', revision: number): AudioEditSpectrogramState {
  const [state, setState] = useState<Omit<AudioEditSpectrogramState, 'retry'>>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const covered = useRef<{ key: string; startFrame: number; endFrame: number; hop: number } | null>(null)
  const plan = duration > 0 && columns > 0 ? planSpectrogramRequest(view, columns, duration) : null
  // 视口仍落在已取范围内、间隔没变时不重取。
  const held = covered.current
  const key = `${projectId}|${mode}|${mode === 'edited' ? revision : ''}|${attempt}`
  const reuse = plan && held && held.key === key && held.hop === plan.hop && held.startFrame <= Math.max(0, view.start) && held.endFrame >= Math.min(duration, view.end)
  const request = plan && !reuse ? `${key}|${plan.startFrame}|${plan.endFrame}|${plan.hop}` : ''

  useEffect(() => {
    if (!plan || !request) return
    let cancelled = false
    setState(previous => ({ ...previous, status: 'loading' }))
    const timer = window.setTimeout(() => void (async () => {
      try {
        const chunks: AudioEditSpectrogramChunk[] = []
        let start = plan.startFrame
        while (start < plan.endFrame && !cancelled) {
          const chunk = await getAudioEditSpectrogram({ projectId, startFrame: start, endFrame: plan.endFrame, mode, fftSize: FFT_SIZE, hop: plan.hop })
          chunks.push(chunk)
          if (chunk.endFrame <= start) break
          start = chunk.endFrame
        }
        if (cancelled || !chunks.length) return
        covered.current = { key, startFrame: plan.startFrame, endFrame: plan.endFrame, hop: plan.hop }
        setState({ data: chunkToSpectrogram(chunks), status: 'ready' })
      } catch (error) {
        if (!cancelled) setState(previous => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : '频谱图没有生成出来。' }))
      }
    })(), DEBOUNCE_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- request encodes the plan, mode, revision and retry attempt
  }, [request])

  return { ...state, retry: () => { covered.current = null; setAttempt(value => value + 1) } }
}
