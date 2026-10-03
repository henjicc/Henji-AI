import React from 'react'
import { useThemeTokens } from '@/hooks/useThemeTokens'
import { useWaveformDetail, type WaveformState } from '@/hooks/useWaveformData'
import { drawWaveform, type WaveformPalette, type WaveformTier, type WaveformTone } from './waveformDraw'

/**
 * 统一波形组件（任务 2.3，重要记录 005）。数据来自 `useWaveformData`，视图用素材绝对时钟的秒数表达；
 * 只负责绘制与“点击 / 拖动定位”回调，业务交互（选区、剪切、平移缩放）留在宿主。
 */
export interface WaveformViewProps {
  waveform: WaveformState
  /** 可见区间（素材绝对时钟秒）；默认整段（容器起点到绝对结束）。 */
  startSeconds?: number
  endSeconds?: number
  /** 自上而下的声道（数据中的序号）；默认全部声道各占一条。 */
  lanes?: readonly number[]
  tier?: WaveformTier
  tone?: WaveformTone
  /** 播放位置（绝对时钟秒），之前的部分按“已播放”着色。 */
  playedSeconds?: number
  /** 已剪去的区间（绝对时钟秒）。 */
  cutRanges?: ReadonlyArray<{ start: number; end: number }>
  /** 固定高度（CSS 像素）；不传则填满父元素。 */
  height?: number
  className?: string
  /** 可访问名称；不传时视为装饰。 */
  label?: string
  /** 悬停读数使用的总时长（秒）；默认可见区间长度。 */
  durationSeconds?: number
  onSeek?: (ratio: number) => void
  onSeekStart?: (ratio: number) => void
  onSeekMove?: (ratio: number) => void
  onSeekEnd?: (ratio: number, dragged: boolean) => void
}

function readout(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export const WaveformView = React.memo(function WaveformView({ waveform, startSeconds, endSeconds, lanes, tier = 'standard', tone = 'neutral', playedSeconds, cutRanges, height, className, label, durationSeconds, onSeek, onSeekStart, onSeekMove, onSeekEnd }: WaveformViewProps) {
  const host = React.useRef<HTMLDivElement | null>(null)
  const canvas = React.useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  const [hoverX, setHoverX] = React.useState<number | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const lastRatio = React.useRef(0)
  const dragged = React.useRef(false)
  const { colors } = useThemeTokens()
  const palette = React.useMemo<WaveformPalette>(() => ({ wave: colors.wave, wavePlayed: colors.wavePlayed, waveCut: colors.waveCut, clipWave: colors.clipWave, line: colors.line, lineStrong: colors.lineStrong }), [colors])
  const data = waveform.data
  const pyramid = data?.pyramid
  const rate = pyramid?.sampleRate ?? 1
  const viewStart = startSeconds ?? pyramid?.startSeconds ?? 0
  const viewEnd = endSeconds ?? pyramid?.endSeconds ?? 0
  const startFrame = viewStart * rate
  const endFrame = viewEnd * rate
  const pixelRatio = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1)
  const columns = Math.max(1, Math.round(size.width * pixelRatio))
  const wantsDetail = tier === 'standard' && !!pyramid && (endFrame - startFrame) / columns < pyramid.levels[0].samplesPerBucket
  const detail = useWaveformDetail(data, Math.max(0, Math.floor(startFrame)), Math.min(pyramid?.frameCount ?? 0, Math.ceil(endFrame)), wantsDetail && size.width > 0)
  const cutKey = cutRanges?.map(range => `${range.start}:${range.end}`).join(',') ?? ''
  const laneKey = lanes?.join(',') ?? ''

  React.useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const measure = (): void => {
      const rect = element.getBoundingClientRect()
      setSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  React.useLayoutEffect(() => {
    const element = canvas.current
    if (!element || size.width <= 0 || size.height <= 0) return
    const width = Math.max(1, Math.round(size.width * pixelRatio))
    const heightPx = Math.max(1, Math.round(size.height * pixelRatio))
    if (element.width !== width) element.width = width
    if (element.height !== heightPx) element.height = heightPx
    const context = element.getContext('2d')
    if (!context) return
    const mode = drawWaveform(context, {
      width, height: heightPx, pixelRatio, data, ...(lanes ? { lanes } : {}), startFrame, endFrame, tier, tone, palette,
      ...(playedSeconds !== undefined ? { playedFrame: playedSeconds * rate } : {}),
      ...(cutRanges?.length ? { cutRanges: cutRanges.map(range => [range.start * rate, range.end * rate] as const) } : {}),
      ...(detail ? { detail } : {}),
    })
    element.dataset.waveformMode = mode
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cutKey / laneKey stand for the arrays' contents
  }, [size, pixelRatio, data, laneKey, startFrame, endFrame, tier, tone, palette, playedSeconds, rate, cutKey, detail])

  const interactive = !!(onSeek || onSeekStart || onSeekMove || onSeekEnd)
  const ratioAt = (event: React.MouseEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
  }
  const handlers = interactive ? {
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const ratio = ratioAt(event)
      setDragging(true); dragged.current = false; lastRatio.current = ratio
      onSeekStart?.(ratio)
    },
    onMouseMove: (event: React.MouseEvent<HTMLDivElement>) => {
      setHoverX(event.clientX - event.currentTarget.getBoundingClientRect().left)
      if (!dragging) return
      const ratio = ratioAt(event)
      dragged.current = true; lastRatio.current = ratio
      onSeekMove?.(ratio)
    },
    onMouseUp: (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const ratio = ratioAt(event)
      const wasDragged = dragged.current
      onSeekEnd?.(ratio, wasDragged)
      if (!wasDragged) onSeek?.(ratio)
      setDragging(false)
    },
    onMouseLeave: () => {
      setHoverX(null)
      if (dragging) { onSeekEnd?.(lastRatio.current, true); setDragging(false) }
    },
  } : {}
  const state = data ? 'ready' : waveform.status
  const hoverSeconds = hoverX === null || size.width <= 0 ? 0 : hoverX / size.width * (durationSeconds ?? Math.max(0, viewEnd - viewStart))
  return (
    <div ref={host} className={`relative min-w-0 ${height === undefined ? 'h-full' : ''} ${interactive ? 'cursor-pointer' : ''} ${className ?? ''}`} style={height === undefined ? undefined : { height }} {...handlers}>
      {/* 采样率与总帧数只供验收读取（判断“解码或命中缓存”都得到真实素材的波形），不显示。 */}
      <canvas ref={canvas} className="block h-full w-full" data-waveform-state={state} data-waveform-sample-rate={pyramid?.sampleRate} data-waveform-frames={pyramid?.frameCount} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} />
      {interactive && hoverX !== null && (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-text1/35" style={{ left: hoverX }} />
          <span className="pointer-events-none absolute top-0.5 rounded-control bg-raised/80 px-1 text-2xs tabular-nums text-text1" style={{ left: Math.max(2, Math.min(size.width - 40, hoverX + 6)) }}>{readout(hoverSeconds)}</span>
        </>
      )}
    </div>
  )
})
