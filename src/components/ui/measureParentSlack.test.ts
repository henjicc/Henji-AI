// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { layoutWidth } from './measureParentSlack'

function sized(screenWidth: number, offsetWidth: number): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({ width: screenWidth, height: 0, x: 0, y: 0, top: 0, left: 0, right: screenWidth, bottom: 0, toJSON: () => ({}) })
  Object.defineProperty(element, 'offsetWidth', { value: offsetWidth })
  return element
}

describe('布局宽度', () => {
  it('画布放大 1.5 倍时把屏幕宽度换回布局宽度，和 clientWidth 同一口径', () => {
    const reference = sized(300, 200)
    expect(layoutWidth(sized(150, 0), reference)).toBe(100)
  })

  it('参照元素被挤得太窄时改用被测元素自己换算；都量不到时原样返回屏幕宽度', () => {
    expect(layoutWidth(sized(150, 100), sized(3, 2))).toBe(100)
    expect(layoutWidth(sized(150, 0), sized(0, 0))).toBe(150)
  })
})
