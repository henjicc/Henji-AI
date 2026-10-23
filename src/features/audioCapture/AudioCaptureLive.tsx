import { useEffect, useRef, useState } from 'react'
import { UiButton } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { drawWaveform } from '@/components/waveform/waveformDraw'
import { getPlatform } from '@/platform/runtime'
import { useThemeTokens } from '@/hooks/useThemeTokens'
import { CaptureWaveform, captureLevelRatio, captureTimecode } from './captureLiveModel'
import type { CaptureSession } from './captureSession'

/** 高频音量和采样只更新 Canvas/读数 DOM；React 仅响应削波标记的变化。 */
export function AudioCaptureLive({ session, sessionId, channels, summary }: { session: CaptureSession; sessionId?: string; channels: number; summary: string }): JSX.Element {
  const time = useRef<HTMLDivElement>(null)
  const levels = useRef<HTMLCanvasElement>(null)
  const waveform = useRef<HTMLCanvasElement>(null)
  const [clipped, setClipped] = useState(false)
  const clipping = useRef(false)
  const tokens = useThemeTokens()
  useEffect(() => {
    let wave = new CaptureWaveform()
    let rms: number[] = [], peaks: number[] = []
    const held = [0, 0], heldAt = [0, 0]
    let frame = 0, lastDraw = 0
    clipping.current = false; setClipped(false)
    const colors = tokens.colors
    const fit = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
      const ratio = window.devicePixelRatio || 1
      const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio)
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      return canvas.getContext('2d')
    }
    const draw = (now: number): void => {
      frame = requestAnimationFrame(draw)
      if (now - lastDraw < 50) return
      lastDraw = now
      if (time.current) time.current.textContent = captureTimecode(session.durationSeconds)
      const meter = levels.current
      if (meter) {
        const ctx = fit(meter)
        if (ctx) {
          ctx.clearRect(0, 0, meter.width, meter.height)
          const lane = meter.height / channels
          for (let channel = 0; channel < channels; channel++) {
            const top = channel * lane + lane * .2, height = lane * .6
            const recording = session.store.getState().phase === 'recording'
            const value = captureLevelRatio(recording ? rms[channel] ?? 0 : 0), peak = captureLevelRatio(recording ? peaks[channel] ?? 0 : 0)
            if (peak >= held[channel] || now - heldAt[channel] > 1500) { held[channel] = peak; heldAt[channel] = now }
            ctx.fillStyle = colors.raised; ctx.fillRect(0, top, meter.width, height)
            ctx.fillStyle = colors.success; ctx.fillRect(0, top, meter.width * Math.min(.95, value), height)
            if (value > .95) { ctx.fillStyle = colors.warning; ctx.fillRect(meter.width * .95, top, meter.width * (value - .95), height) }
            ctx.fillStyle = clipping.current ? colors.danger : colors.text1
            ctx.fillRect(Math.min(meter.width - 2, meter.width * held[channel]), top, 2, height)
          }
        }
      }
      const canvas = waveform.current
      if (canvas) {
        const ctx = fit(canvas)
        if (ctx) drawWaveform(ctx, { width: canvas.width, height: canvas.height, pixelRatio: window.devicePixelRatio || 1, data: wave.snapshot(), startFrame: 0, endFrame: 1000, gain: 1, tier: 'standard', tone: 'neutral', palette: { wave: colors.wave, wavePlayed: colors.wavePlayed, waveCut: colors.waveCut, clipWave: colors.clipWave, line: colors.line, lineStrong: colors.lineStrong } })
      }
    }
    const api = getPlatform().audioCapture
    const releaseLevels = api.onLevel(event => {
      if (event.sessionId !== sessionId) return
      rms = event.rms; peaks = event.peak
      if (event.clipped.some(Boolean) && !clipping.current) { clipping.current = true; setClipped(true) }
    })
    const releaseSamples = api.onSamples(event => { if (event.sessionId === sessionId) wave.push(event) })
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); releaseLevels(); releaseSamples(); wave = new CaptureWaveform() }
  }, [session, sessionId, channels, tokens])
  return <div className="w-full space-y-6">
    <div className="space-y-2">
      <div ref={time} className={`${UI_TEXT_TIMECODE_CLASS} text-display text-center`} aria-label="已录时长" data-capture-timecode>{captureTimecode(session.durationSeconds)}</div>
      {summary && <p className="text-center text-xs text-text2">{summary}</p>}
    </div>
    <div className="space-y-1">
      <div className="flex min-h-control-sm items-center justify-between"><span className="text-xs text-text2">输入电平 · dBFS</span>{clipped && <UiButton variant="dangerSolid" size="sm" tooltip="点击清除削波标记" onClick={() => { clipping.current = false; setClipped(false) }}>削波</UiButton>}</div>
      <canvas ref={levels} className="h-16 w-full" aria-label={`${channels} 声道输入电平`} />
      <div className="relative h-4 text-2xs text-text3">{[-60, -30, -12, -6, -3, 0].map(db => <span key={db} className="absolute" style={{ left: `${(db + 60) / 60 * 100}%`, transform: db === 0 ? 'translateX(-100%)' : db === -60 ? undefined : 'translateX(-50%)' }}>{db}</span>)}</div>
    </div>
    <canvas ref={waveform} className="h-40 w-full" aria-label="最近十秒录音波形" data-capture-waveform />
  </div>
}
