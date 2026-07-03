/**
 * 速度曲线编辑器的几何换算（纯函数，便于复用/单测）。
 *
 * 归一化空间：时间 x∈[0,1]、值 y∈[0,1]（允许手柄超调到 [-0.5,1.5]）；
 * SVG 空间 y 轴向上（0 在底部）。曲线为固定端点 (0,0)→(1,1) 的三次贝塞尔，
 * out 为起点出手柄、in 为终点入手柄，语义对齐 StageBezierEasing。
 */

import { resolveEasingControlPoints } from '../domain/keyframeEngine'
import type { StageEasing } from '../domain/animationTypes'

export interface CurveHandles {
  out: [number, number]
  in: [number, number]
}

export const CURVE_PADDING = 18
export const HANDLE_MIN_Y = -0.5
export const HANDLE_MAX_Y = 1.5

export function easingToHandles(easing: StageEasing): CurveHandles {
  const [x1, y1, x2, y2] = resolveEasingControlPoints(easing)
  return { out: [x1, y1], in: [x2, y2] }
}

export function handlesToEasing(handles: CurveHandles): StageEasing {
  return { type: 'bezier', out: [...handles.out], in: [...handles.in] }
}

/** 缓动预设的 cubic-bezier 系数（与 CSS 标准 ease 系列对齐） */
export const EASING_PRESETS: Array<{ id: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'; label: string }> = [
  { id: 'linear', label: '线性' },
  { id: 'easeIn', label: '缓入' },
  { id: 'easeOut', label: '缓出' },
  { id: 'easeInOut', label: '缓入缓出' },
]

function inner(size: number): number {
  return size - CURVE_PADDING * 2
}

/** 归一化坐标 → SVG 像素坐标（y 轴翻转） */
export function normToSvg(nx: number, ny: number, size: number): { x: number; y: number } {
  return {
    x: CURVE_PADDING + nx * inner(size),
    y: CURVE_PADDING + (1 - ny) * inner(size),
  }
}

/** SVG 像素坐标 → 归一化坐标（x 夹到 [0,1]，y 夹到 [HANDLE_MIN_Y, HANDLE_MAX_Y]） */
export function svgToNorm(px: number, py: number, size: number): { nx: number; ny: number } {
  const span = inner(size)
  const nx = span <= 0 ? 0 : (px - CURVE_PADDING) / span
  const ny = span <= 0 ? 0 : 1 - (py - CURVE_PADDING) / span
  return {
    nx: Math.max(0, Math.min(1, nx)),
    ny: Math.max(HANDLE_MIN_Y, Math.min(HANDLE_MAX_Y, ny)),
  }
}

/** 构造曲线 path（起点 0,0 → 终点 1,1，含两个控制手柄） */
export function buildCurvePath(handles: CurveHandles, size: number): string {
  const start = normToSvg(0, 0, size)
  const end = normToSvg(1, 1, size)
  const c1 = normToSvg(handles.out[0], handles.out[1], size)
  const c2 = normToSvg(handles.in[0], handles.in[1], size)
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`
}
