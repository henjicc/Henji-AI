import React from 'react'
import { UI_ACCENT_HEX, UI_TEXT_LIGHT_HEX } from '@/components/ui'

interface WaveformProps {
  samples: number[]
  width?: number
  height?: number
  progress?: number
  duration: number
  onSeek?: (ratio: number) => void
  onSeekStart?: (ratio: number) => void
  onSeekMove?: (ratio: number) => void
  onSeekEnd?: (ratio: number, dragged: boolean) => void
}

interface BarGeom {
  key: number
  xStart: number
  y: number
  baseW: number
  bh: number
  r: number
}

// 静态灰色波形条 + clipPath 定义只依赖采样数据，与播放进度无关；用 memo 隔离避免进度高频更新时整组波形条重渲染
const StaticBars = React.memo(function StaticBars({ bars, clipId }: { bars: BarGeom[]; clipId: string }) {
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          {bars.map((bar) => (
            <rect key={bar.key} x={bar.xStart} y={bar.y} width={bar.baseW} height={bar.bh} rx={bar.r} ry={bar.r} />
          ))}
        </clipPath>
      </defs>
      <g>
        {bars.map((bar) => (
          <rect key={bar.key} x={bar.xStart} y={bar.y} width={bar.baseW} height={bar.bh} rx={bar.r} ry={bar.r} fill="rgba(120,120,120,0.35)" />
        ))}
      </g>
    </>
  )
})

const Waveform: React.FC<WaveformProps> = ({ samples, width = 0, height = 72, progress = 0, duration, onSeek, onSeekStart, onSeekMove, onSeekEnd }) => {
  const [hoverX, setHoverX] = React.useState<number | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [lastRatio, setLastRatio] = React.useState(0)
  const hasDraggedRef = React.useRef(false)
  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const [vw, setVw] = React.useState<number>(width || 0)
  const clipId = React.useId()
  React.useLayoutEffect(() => {
    const update = () => {
      const el = svgRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setVw(Math.max(1, Math.floor(rect.width)))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const w = vw || width || 576
  const h = height
  const n = samples.length || 1
  const clampedProg = Math.max(0, Math.min(1, progress))
  const coverX = clampedProg * w
  const bars = React.useMemo<BarGeom[]>(() => samples.map((s, i) => {
    const amp = Math.max(0, Math.min(1, s))
    const bh = Math.max(2, Math.floor(amp * h))
    const xStart = Math.floor((i / n) * w)
    const xEnd = Math.floor(((i + 1) / n) * w)
    const baseW = Math.max(1, xEnd - xStart)
    const y = Math.floor((h - bh) / 2)
    const r = Math.min(4, Math.floor(baseW / 3))
    return { key: i, xStart, y, baseW, bh, r }
  }), [samples, w, h, n])
  const posToRatio = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = x / rect.width
    return Math.max(0, Math.min(1, ratio))
  }
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const r = posToRatio(e)
    setDragging(true)
    hasDraggedRef.current = false
    setLastRatio(r)
    onSeekStart && onSeekStart(r)
  }
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = posToRatio(e)
    setHoverX(e.clientX - (e.currentTarget as SVGSVGElement).getBoundingClientRect().left)
    if (dragging) {
      hasDraggedRef.current = true
      setLastRatio(r)
      onSeekMove && onSeekMove(r)
    }
  }
  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const r = posToRatio(e)
    const wasDragged = hasDraggedRef.current
    onSeekEnd && onSeekEnd(r, wasDragged)
    if (!wasDragged && onSeek) onSeek(r)
    setDragging(false)
  }
  const handleMouseLeave = () => {
    setHoverX(null)
    if (dragging) {
      onSeekEnd && onSeekEnd(lastRatio, true)
      setDragging(false)
    }
  }
  return (
    <svg ref={svgRef} width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="block" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave}>
      <StaticBars bars={bars} clipId={clipId} />
      <rect x={0} y={0} width={coverX} height={h} fill={UI_ACCENT_HEX} clipPath={`url(#${clipId})`} />
      {hoverX != null && (<rect x={hoverX} y={0} width={1} height={h} fill="rgba(255,255,255,0.35)" />)}
      {hoverX != null && (
        (() => {
          const ratio = Math.max(0, Math.min(1, hoverX / w))
          const sec = ratio * (duration || 0)
          const t = Math.max(0, Math.floor(sec))
          const mm = Math.floor(t / 60)
          const ss = (t % 60).toString().padStart(2, '0')
          const tx = Math.max(4, Math.min(w - 40, hoverX + 6))
          const ty = 12
          return (
            <g>
              <rect x={tx - 2} y={ty - 10} width={36} height={16} rx={6} ry={6} fill="rgba(20,20,20,0.8)" />
              <text x={tx + 16} y={ty} textAnchor="middle" fontSize="10" fill={UI_TEXT_LIGHT_HEX}>{`${mm}:${ss}`}</text>
            </g>
          )
        })()
      )}
    </svg>
  )
}

export default Waveform
