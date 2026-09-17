import { describe, expect, it } from 'vitest'

import {
  SURFACE_OBSERVATION_SCHEMA_VERSION,
  surfaceCaptureRequestSchema,
} from './surfaceObservation'

describe('surface observation security contract', () => {
  const valid = {
    schemaVersion: SURFACE_OBSERVATION_SCHEMA_VERSION,
    target: 'settings.providers_models',
    rect: { x: 10, y: 20, width: 800, height: 600 },
    masks: [{ x: 30, y: 40, width: 200, height: 32 }],
    maskPolicyId: 'surface.mask_sensitive_fields',
  } as const

  it('接受注册 Surface 内的有界区域和相对遮罩', () => {
    expect(surfaceCaptureRequestSchema.parse(valid)).toEqual(valid)
  })

  it('接受整窗观察目标', () => {
    const windowRequest = { ...valid, target: 'window', maskPolicyId: 'surface.mask_declared_fields' } as const
    expect(surfaceCaptureRequestSchema.parse(windowRequest)).toEqual(windowRequest)
  })

  it('拒绝桌面、其他窗口、超大区域和越界遮罩', () => {
    // 整窗指的是当前应用窗口；桌面和其他应用窗口永远不是合法目标。
    for (const target of ['desktop.fullscreen', 'screen', 'display.primary', 'other.window']) {
      expect(surfaceCaptureRequestSchema.safeParse({ ...valid, target }).success, target).toBe(false)
    }
    expect(surfaceCaptureRequestSchema.safeParse({ ...valid, rect: { ...valid.rect, width: 8_000 } }).success).toBe(false)
    expect(surfaceCaptureRequestSchema.safeParse({
      ...valid,
      masks: [{ x: 799, y: 0, width: 20, height: 20 }],
    }).success).toBe(false)
  })
})
