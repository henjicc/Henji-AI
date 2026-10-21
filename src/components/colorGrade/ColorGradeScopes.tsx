import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { UiEmpty, UiError, UiFormRow, UiIconButton, UiInlineStatus, UiSegmented } from '@/components/ui'
import { UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import { UI_SCOPE_COLORS } from '@/components/ui/styleTokens'
import type { ColorStatistics } from '@/core/imaging/adjustments/colorStatistics'

type ScopeMode = 'histogram' | 'waveform' | 'vectorscope'
const MODES = [{ value: 'histogram' as const, label: '直方图' }, { value: 'waveform' as const, label: '波形' }, { value: 'vectorscope' as const, label: '矢量' }]

/** A readout only turns into a warning when it suggests a correction; otherwise it stays quiet meta text. */
function ReadoutLine({ warning, text }: { warning: boolean; text: string }): React.ReactElement {
  return warning ? <UiInlineStatus tone="warning">{text}</UiInlineStatus> : <span className={UI_TEXT_META_CLASS}>{text}</span>
}

/** Canvas colors resolve theme variables at draw time; channel colors come from the curve channel tokens. */
function drawScope(canvas: HTMLCanvasElement, statistics: ColorStatistics, mode: ScopeMode): void {
  const scopes = statistics.scopes; const context = canvas.getContext('2d')
  if (!scopes || !context) return
  const ratio = window.devicePixelRatio || 1; const width = canvas.clientWidth; const height = canvas.clientHeight
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height)
  const style = getComputedStyle(canvas)
  const neutral = style.getPropertyValue(UI_SCOPE_COLORS.neutralVariable).trim(); const grid = style.getPropertyValue(UI_SCOPE_COLORS.gridVariable).trim()
  context.strokeStyle = grid; context.lineWidth = 1
  for (const f of [.25, .5, .75]) { context.beginPath(); if (mode === 'vectorscope') { context.arc(width / 2, height / 2, Math.min(width, height) / 2 * f, 0, Math.PI * 2) } else { context.moveTo(0, height * f); context.lineTo(width, height * f) } context.stroke() }
  if (mode === 'histogram') {
    context.globalCompositeOperation = 'lighter'
    for (const [values, color] of [[scopes.histogram.red, UI_SCOPE_COLORS.red], [scopes.histogram.green, UI_SCOPE_COLORS.green], [scopes.histogram.blue, UI_SCOPE_COLORS.blue]] as const) {
      context.fillStyle = color; context.globalAlpha = .55; context.beginPath(); context.moveTo(0, height)
      values.forEach((value, i) => context.lineTo(i / (values.length - 1) * width, height - value * height * .95))
      context.lineTo(width, height); context.closePath(); context.fill()
    }
    context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1; context.strokeStyle = neutral; context.beginPath()
    scopes.histogram.luma.forEach((value, i) => { const x = i / (scopes.histogram.luma.length - 1) * width; const y = height - value * height * .95; if (i) context.lineTo(x, y); else context.moveTo(x, y) })
    context.stroke()
  } else if (mode === 'waveform') {
    const { columns, levels, density } = scopes.waveform; context.fillStyle = neutral
    for (let c = 0; c < columns; c++) for (let l = 0; l < levels; l++) {
      const value = density[c * levels + l]; if (!value) continue
      context.globalAlpha = Math.min(1, .15 + Math.sqrt(value)); context.fillRect(c / columns * width, height - (l + 1) / levels * height, width / columns + .5, height / levels + .5)
    }
  } else {
    const { size, density } = scopes.vectorscope; const side = Math.min(width, height); const left = (width - side) / 2; const top = (height - side) / 2
    context.fillStyle = neutral
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const value = density[y * size + x]; if (!value) continue
      // b grows upwards on a vectorscope.
      context.globalAlpha = Math.min(1, .2 + Math.sqrt(value)); context.fillRect(left + x / size * side, top + (size - 1 - y) / size * side, side / size + .5, side / size + .5)
    }
  }
  context.globalAlpha = 1
}

/**
 * Histogram / waveform / vectorscope of the graded picture plus the readouts the assistant reads (same statistics object).
 * The host decides when to refresh (after a committed edit), so dragging never waits for a scope render.
 */
export function ColorGradeScopes({ statistics, busy, error, onRefresh }: { statistics: ColorStatistics | null; busy: boolean; error: string; onRefresh: () => void }): React.ReactElement {
  const [mode, setMode] = useState<ScopeMode>('histogram')
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (canvas.current && statistics) drawScope(canvas.current, statistics, mode) }, [statistics, mode])
  const readout = statistics?.readout
  return <div className="flex flex-col gap-2">
    <UiFormRow label="显示" density="compact" labelColumn="panel">
      <UiSegmented ariaLabel="示波器类型" size="sm" fullWidth value={mode} onChange={setMode} options={MODES} />
    </UiFormRow>
    {error ? <UiError message={error} onRetry={onRefresh} /> : !statistics ? <UiEmpty size="sm" title={busy ? '正在读取画面…' : '暂无读数'} /> : <>
      <canvas ref={canvas} className="aspect-video w-full rounded-control bg-media" aria-label={MODES.find(value => value.value === mode)!.label} />
      {readout && <div className="flex flex-col gap-1">
        <ReadoutLine warning={Math.abs(readout.exposure.middleGrayOffsetEv) > .7 && readout.exposure.key === 'normal'} text={`曝光 ${readout.exposure.middleGrayOffsetEv > 0 ? '+' : ''}${readout.exposure.middleGrayOffsetEv} EV${readout.exposure.key === 'low' ? '（低调画面）' : readout.exposure.key === 'high' ? '（高调画面）' : ''}`} />
        <ReadoutLine warning={readout.clipping.highlightsPercent > .5 || readout.clipping.shadowsPercent > .5} text={`高光溢出 ${readout.clipping.highlightsPercent}% · 暗部死黑 ${readout.clipping.shadowsPercent}%`} />
        <div className="flex items-center justify-between gap-2">
          <ReadoutLine warning={readout.whiteBalance.confidence >= .4 && Math.abs(readout.whiteBalance.kelvin - 6500) > 600} text={`光源约 ${readout.whiteBalance.kelvin} K`} />
          <UiIconButton size="xs" tooltip="重新读取" aria-label="重新读取示波器" loading={busy} onClick={onRefresh}><RefreshCw /></UiIconButton>
        </div>
      </div>}
    </>}
  </div>
}
