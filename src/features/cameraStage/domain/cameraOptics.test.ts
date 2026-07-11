import { describe, expect, it } from 'vitest'
import { focalLengthToFov, fovToFocalLength } from './cameraOptics'

describe('cameraOptics', () => {
  it('FOV 与全画幅等效焦距可稳定往返', () => {
    for (const fov of [10, 27, 50, 90, 120]) {
      expect(focalLengthToFov(fovToFocalLength(fov))).toBeCloseTo(fov, 8)
    }
  })

  it('焦距越长，视野角越小', () => {
    expect(focalLengthToFov(85)).toBeLessThan(focalLengthToFov(24))
  })
})
