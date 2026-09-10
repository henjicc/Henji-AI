import {
  MULTI_ANGLE_DISCRETE_VIEW_PRESETS,
  type MultiAngleContinuousViewV1,
  type MultiAngleDiscretePreset,
  type MultiAngleFluxViewV1,
  type MultiAngleViewV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import { multiAngleOrientation, orientationVector, type MultiAngleOrientation } from './multiAngleOrbitGeometry'

export interface MultiAngleCameraDragOrigin {
  clientX: number
  clientY: number
  yawControlDeg: number
  elevationDeg: number
}

export interface MultiAngleFluxCameraDragOrigin {
  clientX: number
  clientY: number
  horizontalAngleDeg: number
  verticalAngleDeg: number
}

export interface MultiAngleStageMetrics {
  left: number
  top: number
  width: number
  height: number
}

const YAW_MIN = -180
const YAW_MAX = 180
const VERTICAL_MIN = -30
const VERTICAL_MAX = 90
const PROXIMITY_MIN = 0
const PROXIMITY_MAX = 10
const FLUX_HORIZONTAL_MIN = 0
const FLUX_HORIZONTAL_MAX = 360
const FLUX_VERTICAL_MIN = 0
const FLUX_VERTICAL_MAX = 60
const FLUX_ZOOM_MIN = 0
const FLUX_ZOOM_MAX = 10

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function quantize(value: number, step: number): number {
  const precision = String(step).split('.')[1]?.length ?? 0
  return Number((Math.round(value / step) * step).toFixed(precision))
}

function softSnap(value: number, step: number, tolerance: number): number {
  const nearest = quantize(value, step)
  return Math.abs(nearest - value) <= tolerance ? nearest : value
}

export function continuousCameraFromDrag(
  origin: MultiAngleCameraDragOrigin,
  clientX: number,
  clientY: number,
  metrics: Pick<MultiAngleStageMetrics, 'width' | 'height'>,
): Pick<MultiAngleContinuousViewV1, 'yawControlDeg' | 'elevationDeg'> {
  const width = Math.max(metrics.width, 1)
  const height = Math.max(metrics.height, 1)
  return {
    // 直接转动图片块：向右拖露出左侧，向下拖露出顶部。
    yawControlDeg: ((origin.yawControlDeg + ((clientX - origin.clientX) / width) * 180 + 180) % 360 + 360) % 360 - 180,
    elevationDeg: clamp(origin.elevationDeg + ((clientY - origin.clientY) / height) * 120, VERTICAL_MIN, VERTICAL_MAX),
  }
}

export function proximityFromWheel(proximity: number, deltaY: number): number {
  if (deltaY === 0) return proximity
  const direction = deltaY < 0 ? 1 : -1
  return clamp(quantize(proximity + direction * 0.5, 0.5), PROXIMITY_MIN, PROXIMITY_MAX)
}

export function fluxCameraFromDrag(
  origin: MultiAngleFluxCameraDragOrigin,
  clientX: number,
  clientY: number,
  metrics: Pick<MultiAngleStageMetrics, 'width' | 'height'>,
): Pick<MultiAngleFluxViewV1, 'horizontalAngleDeg' | 'verticalAngleDeg'> {
  const width = Math.max(metrics.width, 1)
  const height = Math.max(metrics.height, 1)
  return {
    horizontalAngleDeg: clamp(
      ((origin.horizontalAngleDeg - ((clientX - origin.clientX) / width) * 360) % 360 + 360) % 360,
      FLUX_HORIZONTAL_MIN,
      FLUX_HORIZONTAL_MAX,
    ),
    verticalAngleDeg: clamp(
      origin.verticalAngleDeg + ((clientY - origin.clientY) / height) * 60,
      FLUX_VERTICAL_MIN,
      FLUX_VERTICAL_MAX,
    ),
  }
}

/** Continuous models keep fine control; common-angle attraction and API precision apply only on release. */
export function snapContinuousCamera(view: Pick<MultiAngleContinuousViewV1, 'yawControlDeg' | 'elevationDeg'>): Pick<MultiAngleContinuousViewV1, 'yawControlDeg' | 'elevationDeg'> {
  return { yawControlDeg: clamp(softSnap(quantize(view.yawControlDeg, 1), 45, 3), YAW_MIN, YAW_MAX),
    elevationDeg: clamp(softSnap(quantize(view.elevationDeg, 1), 30, 3), VERTICAL_MIN, VERTICAL_MAX) }
}

export function snapFluxCamera(view: Pick<MultiAngleFluxViewV1, 'horizontalAngleDeg' | 'verticalAngleDeg'>): Pick<MultiAngleFluxViewV1, 'horizontalAngleDeg' | 'verticalAngleDeg'> {
  return { horizontalAngleDeg: clamp(softSnap(quantize(view.horizontalAngleDeg, 1), 45, 3), FLUX_HORIZONTAL_MIN, FLUX_HORIZONTAL_MAX),
    verticalAngleDeg: clamp(softSnap(quantize(view.verticalAngleDeg, 1), 15, 2), FLUX_VERTICAL_MIN, FLUX_VERTICAL_MAX) }
}

export function fluxZoomFromWheel(zoom: number, deltaY: number): number {
  if (deltaY === 0) return zoom
  const direction = deltaY < 0 ? 1 : -1
  return clamp(quantize(zoom + direction * 0.5, 0.5), FLUX_ZOOM_MIN, FLUX_ZOOM_MAX)
}

export function continuousCameraFromKey(
  view: MultiAngleContinuousViewV1,
  key: string,
): Partial<MultiAngleContinuousViewV1> | null {
  if (key === 'ArrowLeft') return { yawControlDeg: clamp(view.yawControlDeg + 15, YAW_MIN, YAW_MAX) }
  if (key === 'ArrowRight') return { yawControlDeg: clamp(view.yawControlDeg - 15, YAW_MIN, YAW_MAX) }
  if (key === 'ArrowUp') return { elevationDeg: clamp(view.elevationDeg + 5, VERTICAL_MIN, VERTICAL_MAX) }
  if (key === 'ArrowDown') return { elevationDeg: clamp(view.elevationDeg - 5, VERTICAL_MIN, VERTICAL_MAX) }
  if (key === 'PageUp') return { proximity: clamp(view.proximity + 0.5, PROXIMITY_MIN, PROXIMITY_MAX) }
  if (key === 'PageDown') return { proximity: clamp(view.proximity - 0.5, PROXIMITY_MIN, PROXIMITY_MAX) }
  if (key === 'Home') return { yawControlDeg: 0, elevationDeg: 0, proximity: 5 }
  return null
}

export function fluxCameraFromKey(
  view: MultiAngleFluxViewV1,
  key: string,
): Partial<MultiAngleFluxViewV1> | null {
  if (key === 'ArrowLeft') {
    return { horizontalAngleDeg: clamp(view.horizontalAngleDeg - 15, FLUX_HORIZONTAL_MIN, FLUX_HORIZONTAL_MAX) }
  }
  if (key === 'ArrowRight') {
    return { horizontalAngleDeg: clamp(view.horizontalAngleDeg + 15, FLUX_HORIZONTAL_MIN, FLUX_HORIZONTAL_MAX) }
  }
  if (key === 'ArrowUp') {
    return { verticalAngleDeg: clamp(view.verticalAngleDeg + 5, FLUX_VERTICAL_MIN, FLUX_VERTICAL_MAX) }
  }
  if (key === 'ArrowDown') {
    return { verticalAngleDeg: clamp(view.verticalAngleDeg - 5, FLUX_VERTICAL_MIN, FLUX_VERTICAL_MAX) }
  }
  if (key === 'PageUp') return { zoom: clamp(view.zoom + 0.5, FLUX_ZOOM_MIN, FLUX_ZOOM_MAX) }
  if (key === 'PageDown') return { zoom: clamp(view.zoom - 0.5, FLUX_ZOOM_MIN, FLUX_ZOOM_MAX) }
  if (key === 'Home') return { horizontalAngleDeg: 0, verticalAngleDeg: 0, zoom: 5 }
  return null
}

export function discreteOrientationFromDrag(origin: MultiAngleOrientation & { clientX: number; clientY: number }, clientX: number, clientY: number, metrics: Pick<MultiAngleStageMetrics, 'width' | 'height'>): MultiAngleOrientation {
  return { azimuth: origin.azimuth - (clientX - origin.clientX) / Math.max(metrics.width, 1) * 360,
    elevation: clamp(origin.elevation + (clientY - origin.clientY) / Math.max(metrics.height, 1) * 180, -90, 90) }
}

export function discretePresetForOrientation(pose: MultiAngleOrientation): MultiAngleDiscretePreset {
  const vector = orientationVector(pose)
  let closest = MULTI_ANGLE_DISCRETE_VIEW_PRESETS[0]
  let score = -Infinity
  for (const preset of MULTI_ANGLE_DISCRETE_VIEW_PRESETS) {
    const target = orientationVector(multiAngleOrientation(preset.view))
    const dot = vector[0] * target[0] + vector[1] * target[1] + vector[2] * target[2]
    if (dot > score) { closest = preset; score = dot }
  }
  return closest.view.preset
}

export function describeMultiAngleVertical(value: number): string {
  if (value > 0) return `俯视 ${Math.round(value)}°`
  if (value < 0) return `仰视 ${Math.round(Math.abs(value))}°`
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
  if (view.kind === 'flux') {
    return `水平 ${view.horizontalAngleDeg}° · 垂直 ${view.verticalAngleDeg}° · Zoom ${view.zoom}`
  }
  const yaw = view.yawControlDeg > 0 ? `左环绕 ${view.yawControlDeg}°`
    : view.yawControlDeg < 0 ? `右环绕 ${Math.abs(view.yawControlDeg)}°`
      : '正面'
  return `${yaw} · ${describeMultiAngleVertical(view.elevationDeg)} · ${describeMultiAngleProximity(view.proximity)}`
}
