import { expect, it } from 'vitest'
import { analyzeImageEditRepairStructureV3, routeImageEditRepairQualityV3, imageEditRepairContextV3 } from './repairQuality'

it('默认大面积/重复纹理精细，小瑕疵经典；显式快速不被改写', () => {
  const roi = { width: 120, height: 180 }
  expect(routeImageEditRepairQualityV3('auto', roi, 0.1)).toBe('fine')
  expect(routeImageEditRepairQualityV3('fast', roi, 0.9)).toBe('fast')
  expect(routeImageEditRepairQualityV3('auto', { width: 16, height: 16 }, 0.5)).toBe('blemish')
  const rgba = new Uint8Array(64 * 64 * 4), mask = new Uint8Array(64 * 64)
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const i = (y * 64 + x) * 4; rgba.fill(y % 8 === 0 ? 20 : 200, i, i + 3); rgba[i + 3] = 255 }
  const structure = analyzeImageEditRepairStructureV3({ region: { x: 0, y: 0, width: 64, height: 64 }, rgba, mask })
  expect(structure.periodic).toBe(true); expect(routeImageEditRepairQualityV3('auto', roi, 0.01, structure)).toBe('fine')
  rgba.fill(127); expect(analyzeImageEditRepairStructureV3({ region: { x: 0, y: 0, width: 64, height: 64 }, rgba, mask }).periodic).toBe(false)
})
it('上下文随遮罩增长并裁到图边，不把大洞盲切', () => {
  expect(imageEditRepairContextV3({ left: 400, top: 400, width: 200, height: 200 }, { width: 1000, height: 1000 })).toEqual({ x: 300, y: 300, width: 400, height: 400 })
  expect(imageEditRepairContextV3({ left: 0, top: 0, width: 900, height: 900 }, { width: 1000, height: 1000 })).toEqual({ x: 0, y: 0, width: 1000, height: 1000 })
})
