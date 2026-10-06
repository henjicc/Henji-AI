import { expect, it, vi } from 'vitest'
import { defaultVideoEditTextStyle } from '@/core/videoEdit/text'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { paintVideoEditText } from './videoEditTextSurface'

function context() {
  return { font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '', lineWidth: 0, lineJoin: '', shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, measureText: (text: string) => ({ width: [...text].length * 20 }), fillRect: vi.fn(), strokeText: vi.fn(), fillText: vi.fn() }
}
it('相同绘制入口应用段落换行、对齐、描边、阴影和背景框', () => {
  const target = context(); const style = { ...defaultVideoEditTextStyle(1080), color: BLACK_HEX, strokeColor: WHITE_HEX, strokeWidth: 2, shadow: true, background: true, boxWidth: 60 / 1920, align: 'right' as const, anchor: 'top' as const }
  paintVideoEditText(target as unknown as OffscreenCanvasRenderingContext2D, { text: '甲乙丙丁', textStyle: style }, 1920, 1080)
  expect(target.fillText.mock.calls.map(call => call[0])).toEqual(['甲乙丙', '丁'])
  expect(target.strokeText).toHaveBeenCalledTimes(2); expect(target.fillRect).toHaveBeenCalledWith(900, 540, 60, 180)
  expect(target.fillStyle).toBe(BLACK_HEX); expect(target.strokeStyle).toBe(WHITE_HEX); expect(target.lineWidth).toBe(4); expect(target.shadowBlur).toBe(style.shadowBlur)
})
it('旧文字的首行仍在序列中心，后续行间距保持原样', () => {
  const target = context()
  paintVideoEditText(target as unknown as OffscreenCanvasRenderingContext2D, { text: '一\n二' }, 1920, 1080)
  expect(target.fillText.mock.calls).toEqual([['一', 960, 540], ['二', 960, 630]])
})
