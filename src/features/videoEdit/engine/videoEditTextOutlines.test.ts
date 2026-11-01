import { expect, it, vi } from 'vitest'
import { textOutlineIdentity, textOutlinePath } from './videoEditTextOutlines'

it('路径缓存按软预算淘汰，再次绘制仍能重建相同内容身份', () => {
  vi.stubGlobal('Path2D', class { constructor(readonly svg: string) {} })
  try {
    const outline = (identity: string) => ({ identity, svg: 'M0 0 '.repeat(120000) })
    const a = outline('outline-a'), first = textOutlinePath(a)
    expect(textOutlinePath(a)).toBe(first)
    textOutlinePath(outline('outline-b'))
    const rebuilt = textOutlinePath(a)
    expect(rebuilt).not.toBe(first)
    expect(textOutlineIdentity(rebuilt)).toBe('outline-a')
  } finally { vi.unstubAllGlobals() }
})
