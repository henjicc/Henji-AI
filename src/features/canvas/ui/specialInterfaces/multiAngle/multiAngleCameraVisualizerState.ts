import {
  MULTI_ANGLE_DISCRETE_VIEW_PRESETS,
  type MultiAngleContinuousViewV1,
  type MultiAngleDiscretePreset,
  type MultiAngleViewV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'

export interface MultiAngleCameraDragOrigin {
  clientX: number
  clientY: number
  yawControlDeg: number
  verticalControl: number
}

export interface MultiAngleStageMetrics {
  left: number
  top: number
  width: number
  height: number
}

const YAW_MIN = -90
const YAW_MAX = 90
const VERTICAL_MIN = -1
const VERTICAL_MAX = 1
const PROXIMITY_MIN = 0
const PROXIMITY_MAX = 10

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function quantize(value: number, step: number): number {
  const precision = String(step).split('.')[1]?.length ?? 0
  return Number((Math.round(value / step) * step).toFixed(precision))
}

export function continuousCameraFromDrag(
  origin: MultiAngleCameraDragOrigin,
  clientX: number,
  clientY: number,
  metrics: Pick<MultiAngleStageMetrics, 'width' | 'height'>,
): Pick<MultiAngleContinuousViewV1, 'yawControlDeg' | 'verticalControl'> {
  const width = Math.max(metrics.width, 1)
  const height = Math.max(metrics.height, 1)
  return {
    // 模型的正向水平控制对应镜头向画面左侧环绕。
    yawControlDeg: clamp(quantize(origin.yawControlDeg - ((clientX - origin.clientX) / width) * 180, 1), YAW_MIN, YAW_MAX),
    verticalControl: clamp(quantize(origin.verticalControl + ((clientY - origin.clientY) / height) * 2, 0.05), VERTICAL_MIN, VERTICAL_MAX),
  }
}

export function proximityFromWheel(proximity: number, deltaY: number): number {
  if (deltaY === 0) return proximity
  const direction = deltaY < 0 ? 1 : -1
  return clamp(quantize(proximity + direction * 0.5, 0.5), PROXIMITY_MIN, PROXIMITY_MAX)
}

export function continuousCameraFromKey(
  view: MultiAngleContinuousViewV1,
  key: string,
): Partial<MultiAngleContinuousViewV1> | null {
  if (key === 'ArrowLeft') return { yawControlDeg: clamp(view.yawControlDeg + 15, YAW_MIN, YAW_MAX) }
  if (key === 'ArrowRight') return { yawControlDeg: clamp(view.yawControlDeg - 15, YAW_MIN, YAW_MAX) }
  if (key === 'ArrowUp') return { verticalControl: clamp(quantize(view.verticalControl - 0.15, 0.05), VERTICAL_MIN, VERTICAL_MAX) }
  if (key === 'ArrowDown') return { verticalControl: clamp(quantize(view.verticalControl + 0.15, 0.05), VERTICAL_MIN, VERTICAL_MAX) }
  if (key === 'PageUp') return { proximity: clamp(view.proximity + 0.5, PROXIMITY_MIN, PROXIMITY_MAX) }
  if (key === 'PageDown') return { proximity: clamp(view.proximity - 0.5, PROXIMITY_MIN, PROXIMITY_MAX) }
  if (key === 'Home') return { yawControlDeg: 0, verticalControl: 0, proximity: 0 }
  return null
}

export function discretePresetFromPoint(
  clientX: number,
  clientY: number,
  metrics: MultiAngleStageMetrics,
): MultiAngleDiscretePreset {
  const halfWidth = Math.max(metrics.width / 2, 1)
  const halfHeight = Math.max(metrics.height / 2, 1)
  const point = {
    x: clamp((clientX - metrics.left - halfWidth) / halfWidth, -1, 1),
    y: clamp((clientY - metrics.top - halfHeight) / halfHeight, -1, 1),
  }
  let closest = MULTI_ANGLE_DISCRETE_VIEW_PRESETS[0]
  let closestDistance = Number.POSITIVE_INFINITY
  for (const preset of MULTI_ANGLE_DISCRETE_VIEW_PRESETS) {
    const distance = Math.hypot(point.x - preset.visual.x, point.y - preset.visual.y)
    if (distance < closestDistance) {
      closest = preset
      closestDistance = distance
    }
  }
  return closest.view.preset
}

export function describeMultiAngleVertical(value: number): string {
  if (value <= -0.05) return `高位 ${Math.round(Math.abs(value) * 100)}%`
  if (value >= 0.05) return `低位 ${Math.round(value * 100)}%`
  return '水平'
}

export function describeMultiAngleProximity(value: number): string {
  if (value <= 2) return '全景'
  if (value <= 4) return '远景'
  if (value <= 6) return '中景'
  if (value <= 8) return '近景'
  return '特写'
}

export function describeMultiAngleCamera(view: MultiAngleViewV1): string {
  if (view.kind === 'discrete') return view.label
  const yaw = view.yawControlDeg > 0 ? `左环绕 ${view.yawControlDeg}°`
    : view.yawControlDeg < 0 ? `右环绕 ${Math.abs(view.yawControlDeg)}°`
      : '正面'
  return `${yaw} · ${describeMultiAngleVertical(view.verticalControl)} · ${describeMultiAngleProximity(view.proximity)}`
}
