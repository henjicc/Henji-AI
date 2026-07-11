import { describe, expect, it } from 'vitest'
import { resolveDropdownDisplay } from './dropdownUtils'

describe('Dropdown 显示文本', () => {
  const options = [
    { label: '自定义贝塞尔', value: 'bezier' },
    { label: '直线', value: 'linear' },
  ]

  it('默认显示匹配选项的中文标签', () => {
    expect(resolveDropdownDisplay(undefined, 'bezier', options)).toBe('自定义贝塞尔')
  })

  it('显式 display 优先于选项标签，未知值回退原值', () => {
    expect(resolveDropdownDisplay('当前路径', 'bezier', options)).toBe('当前路径')
    expect(resolveDropdownDisplay(undefined, 'unknown', options)).toBe('unknown')
  })
})
