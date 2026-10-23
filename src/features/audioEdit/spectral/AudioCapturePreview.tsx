import { useEffect, useRef } from 'react'
import { useThemeTokens } from '@/hooks/useThemeTokens'
import { AUDIO_SCOPE_COLORS } from '@/core/theme/colorTokens'
import { hzAtY, type FrequencyView } from './spectralEditorModel'
import type { WaveformViewport } from '../waveformViewport'
import { getAudioCaptureSession } from '@/features/audioCapture'

/** 实时画面直接读采样摘要，绘制与电平同为 20fps，不让作品状态每帧重渲染。 */
export function AudioCapturePreview({ mode, view, rate, frequency }: { mode: 'waveform' | 'spectrum'; view: WaveformViewport; rate: number; frequency: FrequencyView }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ view, frequency }); latest.current = { view, frequency }
  const tokens = useThemeTokens()
  useEffect(() => {
    const session = getAudioCaptureSession()
    let timer = 0, lastDraw = 0
    const draw = (now: number): void => {
      timer = requestAnimationFrame(draw)
      if (now - lastDraw < 50) return
      lastDraw = now
      const element = canvas.current, placement = session.store.getState().placement
      if (!element || !placement) return
      const dpr = window.devicePixelRatio || 1
      const width = Math.round(element.clientWidth * dpr), height = Math.round(element.clientHeight * dpr)
      if (element.width !== width) element.width = width
      if (element.height !== height) element.height = height
      const ctx = element.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)
      const { view: current, frequency: freq } = latest.current
      const x = (seconds: number): number => (placement.startFrame + seconds * rate - current.start) / Math.max(1, current.end - current.start) * width
      const columns = session.preview.columns
      for (const column of columns) {
        const left = x(column.start), right = x(column.end)
        if (right < 0 || left > width) continue
        const w = Math.max(1, right - left)
        ctx.globalAlpha = 1; ctx.fillStyle = AUDIO_SCOPE_COLORS.background; ctx.fillRect(left, 0, w, height)
        const lane = height / column.peaks.length
        for (let channel = 0; channel < column.peaks.length; channel++) {
          if (mode === 'waveform') {
            const amplitude = Math.max(1, Math.min(1, column.peaks[channel]) * lane * .45)
            ctx.fillStyle = tokens.colors.danger; ctx.fillRect(left, (channel + .5) * lane - amplitude, w, amplitude * 2)
          } else {
            ctx.fillStyle = tokens.colors.warning
            for (let row = 0; row < 64; row++) {
              const hz = hzAtY(row + .5, 64, freq)
              const bin = Math.min(127, Math.floor(hz / (session.preview.sampleRate / 2) * 128))
              const value = column.spectrum[channel]?.[bin] ?? 0
              ctx.globalAlpha = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-6, value)) + 80) / 80))
              ctx.fillRect(left, channel * lane + row / 64 * lane, w, lane / 64 + 1)
            }
            ctx.globalAlpha = 1
          }
        }
      }
    }
    timer = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(timer)
  }, [mode, rate, tokens])
  return <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-label={mode === 'waveform' ? '正在录入的波形' : '正在录入的频谱'} data-capture-preview={mode} />
}
