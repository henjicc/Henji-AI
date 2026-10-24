/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Plus } from 'lucide-react'
import { UiButton, UiIconButton, UiInput, UiSelect, UiFieldTrigger, UiChipButton, UiNavButton, UiSwitch, UiReadout, UiNumberStepper } from './primitives'
import { UiSegmented } from './UiSegmented'
import type { UiControlSize } from './primitiveInternals'

afterEach(cleanup)

describe('共享控件同名档同高', () => {
  it('统一分段遵循中性选中与显式外壳尺寸', () => {
    const view = render(<UiSegmented ariaLabel="分段" size="lg" options={[{ value: "a", label: "选中" }]} value="a" onChange={() => undefined} />)
    const button = view.getByRole('radio')
    expect(button.classList.contains('bg-segment-selected')).toBe(true)
    expect(view.getByRole('radiogroup').classList.contains('h-control-lg')).toBe(true)
  })
  it.each(['sm', 'md', 'lg'] as UiControlSize[])('%s 包含分段外壳，与按钮和字段等高', size => {
    const view = render(<>
      <UiButton size={size}>动作</UiButton>
      <UiIconButton size={size} aria-label="图标"><Plus /></UiIconButton>
      <UiInput size={size} aria-label="输入" />
      <UiSelect size={size} aria-label="选择"><option>一</option></UiSelect>
      <UiFieldTrigger size={size}>字段</UiFieldTrigger>
      <UiChipButton size={size}>标签</UiChipButton>
      <UiNavButton size={size}>导航</UiNavButton>
      <UiNumberStepper size={size} increaseLabel="增加" decreaseLabel="减少" canIncrease canDecrease onStep={() => {}} />
      <UiReadout size={size}>100%</UiReadout>
      <UiSwitch appearance="segmented" size={size} checked offLabel="关" onLabel="开" />
      <UiSegmented ariaLabel="分段" size={size} options={[{ label: '一', value: 'one' }, { label: '二', value: 'two' }]} value="one" onChange={() => {}} />
    </>)
    // 原生 select 包在字段外壳里；分段外面有一层只测可用宽度的外壳（放不下时换成下拉），量里面的分段本体
    const control = (child: Element): Element => (child.matches('[data-ui-segmented-fit]') && child.firstElementChild) || (child.matches('div') && child.querySelector('select')) || child
    for (const child of view.container.children) expect(control(child).classList.contains(`h-control-${size}`), child.outerHTML).toBe(true)
  })

  it('默认图标按钮与文字按钮都为 md；按钮自动决定子图标尺寸', () => {
    const view = render(<><UiButton><Plus />添加</UiButton><UiIconButton aria-label="添加图标"><Plus /></UiIconButton></>)
    for (const button of view.getAllByRole('button')) {
      expect(button.classList.contains('h-control-md')).toBe(true)
      expect(button.classList.contains('[&_svg.lucide]:size-4')).toBe(true)
    }
  })
})
