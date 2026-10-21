import { describe, expect, it } from 'vitest'
import { applyMat3, deltaE2000, displayHueToOklabHue, illuminantXy, linearSrgbToOklab, luminance, oklabHueToDisplayHue, oklabToLinearSrgb, oklabHue, whiteBalanceMatrix, xyToKelvinDuv, xyToXyz, xyzToLinearSrgb, D65_XY, IDENTITY_MAT3 } from './colorScience'

describe('color science', () => {
  it('matches the CIEDE2000 reference pairs', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4)
    expect(deltaE2000([50, -1.3802, -84.2814], [50, 0, -82.7485])).toBeCloseTo(1.0, 3)
    expect(deltaE2000([2.0776, .0795, -1.135], [.9033, -.0636, -.5514])).toBeCloseTo(.9082, 4)
  })
  it('makes 6500 K the D65 identity and inverts temperature/Duv', () => {
    expect(illuminantXy(6500)[0]).toBeCloseTo(D65_XY[0], 6)
    expect(illuminantXy(6500)[1]).toBeCloseTo(D65_XY[1], 6)
    expect(whiteBalanceMatrix(6500, 0)).toBe(IDENTITY_MAT3)
    for (const [kelvin, duv] of [[2800, 0], [4300, .01], [9000, -.02], [15000, .004]]) {
      const back = xyToKelvinDuv(...illuminantXy(kelvin, duv))
      expect(back.kelvin / kelvin).toBeCloseTo(1, 3)
      expect(back.duv).toBeCloseTo(duv, 5)
    }
  })
  it('neutralizes a picture lit by the named light and preserves grey luminance', () => {
    const warm = xyzToLinearSrgb(xyToXyz(...illuminantXy(3200), .4))
    const corrected = applyMat3(whiteBalanceMatrix(3200, 0), warm)
    expect(corrected[0] / corrected[2]).toBeCloseTo(1, 3)
    expect(corrected[1] / corrected[2]).toBeCloseTo(1, 3)
    expect(luminance(corrected)).toBeCloseTo(luminance(warm), 5)
    // Lower than the reference cools, higher warms.
    const grey = [.2, .2, .2]
    expect(applyMat3(whiteBalanceMatrix(4000, 0), grey)[2]).toBeGreaterThan(.2)
    expect(applyMat3(whiteBalanceMatrix(9000, 0), grey)[0]).toBeGreaterThan(.2)
    expect(applyMat3(whiteBalanceMatrix(6500, 50), grey)[1]).toBeLessThan(.2)
  })
  it('round-trips OkLab and keeps display hue anchors on the HSL wheel', () => {
    const rgb = [.3, -.02, .8]
    const back = oklabToLinearSrgb(linearSrgbToOklab(rgb))
    back.forEach((value, i) => expect(value).toBeCloseTo(rgb[i], 6))
    const hues = [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1]].map(color => oklabHueToDisplayHue(oklabHue(linearSrgbToOklab(color))))
    hues.forEach((hue, i) => expect(Math.min(Math.abs(hue - i * 60), 360 - Math.abs(hue - i * 60))).toBeLessThan(1e-6))
    for (const display of [15, 95, 200, 330]) expect(oklabHueToDisplayHue(displayHueToOklabHue(display))).toBeCloseTo(display, 6)
  })
})
