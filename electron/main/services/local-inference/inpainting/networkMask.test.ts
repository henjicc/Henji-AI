import { expect, it } from 'vitest'
import { expandInpaintNetworkMask } from './networkMask'
it('复用OpenCV外扩模型孔洞，原覆盖率保持不变', async () => {
  const mask = new Uint8Array(9 * 9); mask[40] = 255
  const expanded = await expandInpaintNetworkMask(mask, 9, 9, 2)
  expect(expanded[40]).toBe(255); expect(expanded[42]).toBe(255); expect(expanded[0]).toBe(0)
  expect(mask.filter(value => value > 0)).toHaveLength(1)
  expect(await expandInpaintNetworkMask(Uint8Array.of(0, 255, 255, 255), 4, 1, 3)).toEqual(Uint8Array.of(0, 255, 255, 255))
})
