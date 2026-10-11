import { useEffect, useRef } from 'react'

export interface CreativeIntentGhost { position: readonly [number, number]; turns: number; scale: number; pinned: boolean; breakBefore?: boolean; corners: readonly (readonly [number, number])[] }
/** Only a sampled view is drawn; the adapter retains every original sample/page. */
export function CreativeIntentOverlay({ ghosts, variant = 'motion' }: { ghosts: readonly CreativeIntentGhost[]; variant?: 'motion' | 'layout' }): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const surface = canvas.current; if (!surface) return
    const draw = (): void => {
      const rect = surface.getBoundingClientRect(); const dpr = surface.ownerDocument.defaultView?.devicePixelRatio ?? 1
      surface.width = Math.round(rect.width * dpr); surface.height = Math.round(rect.height * dpr)
      const ctx = surface.getContext('2d'); if (!ctx) return
      const css = getComputedStyle(surface); ctx.strokeStyle = css.color; ctx.fillStyle = css.color
      ctx.lineWidth = 1.5 * dpr; ctx.beginPath()
      ghosts.forEach((g, i) => { const x = g.position[0] * surface.width; const y = g.position[1] * surface.height; if (!i || g.breakBefore) ctx.moveTo(x, y); else ctx.lineTo(x, y) }); ctx.stroke()
      ghosts.forEach((g, i) => {
        if (variant !== 'layout' && !g.pinned && i % Math.max(1, Math.ceil(ghosts.length / 12))) return
        const x = g.position[0] * surface.width; const y = g.position[1] * surface.height
        ctx.save(); ctx.translate(x, y); ctx.rotate(g.turns * Math.PI * 2); ctx.globalAlpha = g.pinned ? 1 : variant === 'layout' ? .7 : .35
        if (variant === 'layout' && !g.pinned) ctx.setLineDash([4 * dpr, 3 * dpr])
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath()
        g.corners.forEach((p, index) => { if (index === 0) ctx.moveTo(p[0] * surface.width, p[1] * surface.height); else ctx.lineTo(p[0] * surface.width, p[1] * surface.height) }); ctx.closePath(); ctx.stroke()
        if (g.pinned) { ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2); ctx.fill() } ctx.restore()
      })
    }
    draw(); const observer = new ResizeObserver(draw); observer.observe(surface); return () => observer.disconnect()
  }, [ghosts, variant])
  return <canvas ref={canvas} aria-label="示范姿态残影与轨迹" className="pointer-events-none absolute inset-0 h-full w-full text-accent-text" />
}
