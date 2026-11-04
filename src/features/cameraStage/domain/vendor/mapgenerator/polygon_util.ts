/*
 * 移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，提交 f487e4cee321d105d5b0e14258363fa8b4d004ef）
 * 的 src/ts/impl/polygon_util.ts。按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 *
 * 2026-11-04 痕迹AI 的修改：只保留点在多边形内的判断；地块切分与缓冲区（原用 jsts、PolyK）不移植，
 * 布景的街区与地块改由 clipper2-ts 的布尔运算求得。
 */

import Vector from './vector'

/** 射线法，见 https://wrf.ecse.rpi.edu/Research/Short_Notes/pnpoly.html */
export function insidePolygon(point: Vector, polygon: readonly Vector[]): boolean {
  if (polygon.length === 0) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}
