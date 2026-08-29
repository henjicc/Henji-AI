import type { TFunction } from 'i18next'

import type {
  MultiAngleConfigV1,
  MultiAngleViewV1,
} from '@/features/canvas/capabilities/multiAnglePolicy'

const PREFIX = 'node.multiAngleEditor'

export function translateMultiAngleViewLabel(
  t: TFunction,
  view: MultiAngleViewV1,
  index = 0,
): string {
  if (view.kind === 'discrete') {
    return t(`${PREFIX}.presets.discrete.${view.preset}`, { defaultValue: view.label })
  }
  if (view.presetId === 'custom') {
    return t(
      view.kind === 'flux' ? `${PREFIX}.customFluxView` : `${PREFIX}.customView`,
      { index: index + 1 },
    )
  }
  return t(`${PREFIX}.presets.${view.kind}.${view.presetId}`, {
    defaultValue: view.label,
  })
}

export function describeLocalizedMultiAngleVertical(t: TFunction, value: number): string {
  if (value <= -0.05) {
    return t(`${PREFIX}.camera.highPercent`, { value: Math.round(Math.abs(value) * 100) })
  }
  if (value >= 0.05) {
    return t(`${PREFIX}.camera.lowPercent`, { value: Math.round(value * 100) })
  }
  return t(`${PREFIX}.camera.level`)
}

export function describeLocalizedMultiAngleProximity(t: TFunction, value: number): string {
  if (value <= 2) return t(`${PREFIX}.camera.panorama`)
  if (value <= 4) return t(`${PREFIX}.camera.longShot`)
  if (value <= 6) return t(`${PREFIX}.camera.mediumShot`)
  if (value <= 8) return t(`${PREFIX}.camera.nearShot`)
  return t(`${PREFIX}.camera.closeUp`)
}

export function describeLocalizedMultiAngleCamera(
  t: TFunction,
  view: MultiAngleViewV1,
  index = 0,
): string {
  if (view.kind === 'discrete') return translateMultiAngleViewLabel(t, view, index)
  if (view.kind === 'flux') {
    return t(`${PREFIX}.camera.flux`, {
      horizontal: view.horizontalAngleDeg,
      vertical: view.verticalAngleDeg,
      zoom: view.zoom,
    })
  }
  const yaw = view.yawControlDeg > 0
    ? t(`${PREFIX}.camera.orbitLeft`, { value: view.yawControlDeg })
    : view.yawControlDeg < 0
      ? t(`${PREFIX}.camera.orbitRight`, { value: Math.abs(view.yawControlDeg) })
      : t(`${PREFIX}.camera.front`)
  return `${yaw} · ${describeLocalizedMultiAngleVertical(t, view.verticalControl)} · ${describeLocalizedMultiAngleProximity(t, view.proximity)}`
}

export function summarizeLocalizedMultiAngleConfig(
  t: TFunction,
  config: MultiAngleConfigV1,
): string {
  const profile = config.controlProfile === 'continuous-v1'
    ? t(`${PREFIX}.profiles.continuous.title`)
    : config.controlProfile === 'discrete-v1'
      ? t(`${PREFIX}.profiles.discrete.title`)
      : t(`${PREFIX}.profiles.flux.title`)
  return t(`${PREFIX}.summary`, { profile, count: config.views.length })
}
