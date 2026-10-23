import { useEffect, useRef, useState } from 'react'
import { Circle } from 'lucide-react'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { UiButton } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { getPlatform } from '@/platform/runtime'
import { useThemeTokens } from '@/hooks/useThemeTokens'
import { captureLevelRatio, captureTimecode } from './captureLiveModel'
import type { CaptureSession } from './captureSession'

/** 高频音量和采样只更新 Canvas/读数 DOM；React 仅响应削波标记的变化。 */
export function AudioCaptureLive({ session, sessionId, channels, summary }: { session: CaptureSession; sessionId?: string; channels: number; summary: string }): JSX.Element {
  const time = useRef<HTMLDivElement>(null)
  const levels = useRef<HTMLCanvasElement>(null)
  const [clipped, setClipped] = useState(false)
  const clipping = useRef(false)
  const tokens = useThemeTokens()
  useEffect(() => {
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
    }
    const api = getPlatform().audioCapture
    const releaseLevels = api.onLevel(event => {
      if (event.sessionId !== sessionId) return
      rms = event.rms; peaks = event.peak
      if (event.clipped.some(Boolean) && !clipping.current) { clipping.current = true; setClipped(true) }
    })
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); releaseLevels() }
  }, [session, sessionId, channels, tokens])
  return <div className="flex items-center gap-2" aria-label={summary || '录音电平与时长'}>
    <canvas ref={levels} className="h-6 w-24" aria-label={`${channels} 声道输入电平`} />
    <span className="flex shrink-0 items-center gap-1.5"><Circle size={UI_ICON_SIZE.xs} fill="currentColor" className="text-danger-text" aria-hidden="true" /><span ref={time} className={`${UI_TEXT_TIMECODE_CLASS} text-sm`} aria-label="已录时长" data-capture-timecode>{captureTimecode(session.durationSeconds)}</span></span>
    {clipped && <UiButton variant="danger" size="sm" tooltip="点击清除削波标记" onClick={() => { clipping.current = false; setClipped(false) }}>削波</UiButton>}
  </div>
}
