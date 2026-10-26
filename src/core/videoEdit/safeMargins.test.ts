import { expect, it } from 'vitest'
import { videoEditSafeArea } from './safeMargins'

it('安全框按画面自身宽高计算：动作安全区 93%、字幕与图形安全区 90%，四边对称', () => {
  for (const [kind, margin, size] of [['action', 0.035, 0.93], ['title', 0.05, 0.9]] as const) {
    const area = videoEditSafeArea(kind)
    expect(area.x).toBeCloseTo(margin, 12); expect(area.y).toBeCloseTo(margin, 12)
    expect(area.width).toBeCloseTo(size, 12); expect(area.height).toBeCloseTo(size, 12)
    expect(area.x + area.width).toBeCloseTo(1 - margin, 12)
  }
})
