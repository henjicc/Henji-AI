import { describe, expect, it } from 'vitest'

import {
  SURFACE_OBSERVATION_SCHEMA_VERSION,
  surfaceCaptureRequestSchema,
} from './surfaceObservation'

describe('surface observation security contract', () => {
  const valid = {
    schemaVersion: SURFACE_OBSERVATION_SCHEMA_VERSION,
    surfaceId: 'settings.api_keys',
    rect: { x: 10, y: 20, width: 800, height: 600 },
    masks: [{ x: 30, y: 40, width: 200, height: 32 }],
    maskPolicyId: 'surface.mask_sensitive_fields',
  } as const

  it('接受注册 Surface 内的有界区域和相对遮罩', () => {
    expect(surfaceCaptureRequestSchema.parse(valid)).toEqual(valid)
  })

  it('拒绝未知 Surface、超大区域和越界遮罩', () => {
    expect(surfaceCaptureRequestSchema.safeParse({ ...valid, surfaceId: 'desktop.fullscreen' }).success).toBe(false)
    expect(surfaceCaptureRequestSchema.safeParse({ ...valid, rect: { ...valid.rect, width: 8_000 } }).success).toBe(false)
    expect(surfaceCaptureRequestSchema.safeParse({
      ...valid,
      masks: [{ x: 799, y: 0, width: 20, height: 20 }],
    }).success).toBe(false)
  })
})
