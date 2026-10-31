import { expect, it } from 'vitest'
import { detectVideoEditBanding } from './bandingReview'

const width = 960, height = 540
const fract = (value: number): number => value - Math.floor(value)
const noise = (x: number, y: number): number => fract(52.9829189 * fract(.06711056 * x + .00583715 * y)) - .5
function image(paint: (x: number, y: number) => number[]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([...paint(x, y).map(Math.round), 255], (y * width + x) * 4)
  return pixels
}
const radial = (x: number, y: number): number[] => {
  const t = Math.min(1, Math.hypot((x - width / 2) / (width * .65), (y - height / 2) / (height * .85)))
  return [21 - 8 * t, 22 - 8 * t, 26 - 10 * t]
}
const shadow = (x: number, y: number): number[] => {
  const distance = Math.hypot(Math.max(0, Math.abs(x - width / 2) - width * .25), Math.max(0, Math.abs(y - height / 2) - height * .2))
  const value = distance === 0 ? 50 : 14 * (1 - .28 * Math.exp(-distance * distance / (2 * 45 * 45)))
  return [value, value, value]
}
it.each([['极浅径向渐变', radial], ['暗底柔和窗口阴影', shadow]] as const)('%s 报出平台位置，加最终半级交错噪声后不报', (_name, paint) => {
  const banding = detectVideoEditBanding(image(paint), width, height)
  expect(banding.length).toBeGreaterThan(0)
  for (const { region, levels } of banding) {
    expect(levels).toBeGreaterThanOrEqual(2)
    expect(region.x).toBeGreaterThanOrEqual(0); expect(region.y).toBeGreaterThanOrEqual(0)
    expect(region.x + region.width).toBeLessThanOrEqual(1); expect(region.y + region.height).toBeLessThanOrEqual(1)
  }
  expect(detectVideoEditBanding(image((x, y) => paint(x, y).map(value => value + noise(x, y))), width, height)).toEqual([])
})
it('纯色、照片类纹理噪声、暗部视频噪点和带抗锯齿的文字边缘不报', () => {
  for (const paint of [
    () => [14, 14, 14],
    (x: number, y: number) => [80 + x / 12 + noise(x, y) * 24, 90 + y / 8 + noise(x + 7, y) * 20, 120 + noise(x, y + 9) * 30],
    (x: number, y: number) => radial(x, y).map(value => value + noise(x, y) * 5),
    (x: number, y: number) => { const edge = Math.min(x % 40, 39 - x % 40, y % 60, 59 - y % 60); const value = edge < 2 ? 14 + edge * 100 : 220; return [value, value, value] },
  ]) expect(detectVideoEditBanding(image(paint), width, height)).toEqual([])
})
it('水平与竖直浅台阶都能定位，不接受一个薄条里的偶然平台', () => {
  expect(detectVideoEditBanding(image((x, y) => [14 + y / height * 6, 14 + y / height * 6, 14 + y / height * 6]), width, height)).toEqual(expect.arrayContaining([expect.objectContaining({ axis: 'vertical' })]))
  expect(detectVideoEditBanding(image((x, y) => { const value = y > 100 && y < 103 ? 14 + x / width * 6 : 14; return [value, value, value] }), width, height)).toEqual([])
})
it('台阶后接到画面边缘的大片底色不算进区域', () => {
  const found = detectVideoEditBanding(image((_x, y) => { const value = y < 200 ? 18 - Math.floor(y / 50) : 14; return [value, value, value] }), width, height)
  expect(found.length).toBeGreaterThan(0)
  for (const { region } of found) expect(region.y + region.height).toBeLessThanOrEqual(260 / height)
})
it('4K 原尺寸的八级台阶仍可定位，原像素抖动不会被缩图吞掉', () => {
  const width = 3840, height = 2160, pixels = new Uint8ClampedArray(width * height * 4)
  for (const dither of [false, true]) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const value = Math.round(21 - x / width * 8 + (dither ? noise(x, y) : 0))
      pixels.set([value, value, value, 255], (y * width + x) * 4)
    }
    const found = detectVideoEditBanding(pixels, width, height)
    if (dither) expect(found).toEqual([])
    else expect(found.length).toBeGreaterThan(0)
  }
})

it.each(['径向渐变窗口遮挡', '14/255 台面柔和阴影'] as const)('4K %s：窗口占七成宽六成高，只露四周仍报出', kind => {
  const width = 3840, height = 2160, pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = Math.max(0, Math.abs(x - width / 2) - width * .35), dy = Math.max(0, Math.abs(y - height / 2) - height * .3)
    const t = Math.min(1, Math.hypot((x - width / 2) / (width * .65), (y - height / 2) / (height * .85)))
    const shade = 14 * (1 - .28 * Math.exp(-(dx * dx + dy * dy) / (2 * 180 * 180)))
    const rgb = !dx && !dy ? [50, 50, 50] : kind === '径向渐变窗口遮挡' ? [21 - 8 * t, 22 - 8 * t, 26 - 10 * t] : [shade, shade, shade]
    pixels.set([...rgb.map(Math.round), 255], (y * width + x) * 4)
  }
  const found = detectVideoEditBanding(pixels, width, height)
  expect(found.length).toBeGreaterThan(0)
  expect(found.some(({ region }) => region.x < .15 || region.y < .2 || region.x + region.width > .85 || region.y + region.height > .8)).toBe(true)
})
it('蓝色通道渐变和半透明画面合成黑底后仍能定位台阶，尺寸失败给出实际值', () => {
  expect(detectVideoEditBanding(image(x => [0, 0, 14 + x / width * 6]), width, height).length).toBeGreaterThan(0)
  const pixels = image(x => [28 + x / width * 12, 28 + x / width * 12, 28 + x / width * 12])
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 128
  expect(detectVideoEditBanding(pixels, width, height).length).toBeGreaterThan(0)
  const flattened = pixels.slice()
  for (let i = 0; i < pixels.length; i += 4) { for (let c = 0; c < 3; c++) flattened[i + c] = Math.round(pixels[i + c] * 128 / 255); flattened[i + 3] = 255 }
  expect(detectVideoEditBanding(pixels, width, height)).toEqual(detectVideoEditBanding(flattened, width, height))
  expect(() => detectVideoEditBanding(new Uint8ClampedArray(7), 2, 1)).toThrow('2×1 需要 8 个通道值，实际 7 个')
})
