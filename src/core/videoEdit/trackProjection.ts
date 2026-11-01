import type { VideoEditTrackQuad } from './tracking'

/** Convex, consistently ordered corners; tracked results may extend beyond the picture. */
export function isVideoEditTrackQuad(quad: readonly (readonly number[])[]): boolean {
  if (quad.length !== 4 || quad.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v)))) return false
  const crosses = quad.map((a, i) => { const b = quad[(i + 1) % 4]; const c = quad[(i + 2) % 4]; return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) })
  return crosses.every(v => v > 1e-8) || crosses.every(v => v < -1e-8)
}


export function videoEditTrackProject(matrix: readonly number[], x: number, y: number): [number, number] {
  const w = matrix[6] * x + matrix[7] * y + matrix[8]
  return [(matrix[0] * x + matrix[1] * y + matrix[2]) / w, (matrix[3] * x + matrix[4] * y + matrix[5]) / w]
}
export function invertVideoEditTrackMatrix(m: readonly number[]): number[] {
  const [a,b,c,d,e,f,g,h,i]=m
  const adj=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d]
  const determinant=a*adj[0]+b*adj[3]+c*adj[6]
  if (!Number.isFinite(determinant) || Math.abs(determinant)<1e-12) throw new Error('透视四角已退化，请重新选取平面。')
  return adj.map(v=>v/determinant)
}
/** Exact four-corner geometry (no estimation): unit image square → normalized destination quad. */
export function videoEditCornerPinMatrix(quad: VideoEditTrackQuad): number[] {
  if (!isVideoEditTrackQuad(quad)) throw new Error('角点贴合需要有效的四边形。')
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] = quad
  const dx1=x1-x2; const dx2=x3-x2; const dx3=x0-x1+x2-x3
  const dy1=y1-y2; const dy2=y3-y2; const dy3=y0-y1+y2-y3
  const d=dx1*dy2-dx2*dy1
  const g=(dx3*dy2-dx2*dy3)/d; const h=(dx1*dy3-dx3*dy1)/d
  return [x1-x0+g*x1, x3-x0+h*x3, x0, y1-y0+g*y1, y3-y0+h*y3, y0, g, h, 1]
}

