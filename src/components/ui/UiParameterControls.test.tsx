// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UiAngleDial } from './UiAngleDial'
import { UiPointPad } from './UiPointPad'
import { UiRangeSlider } from './UiRangeSlider'
import { UiGradientEditor, type UiGradientStop } from './UiGradientEditor'
import { UiGradeWheel } from './UiGradeWheel'
import { UiCurveEditor } from './UiCurveEditor'
import { UiEasingEditor, type UiCubicBezier } from './UiEasingEditor'
import { UiSeedInput } from './UiSeedInput'
import { uiParameterHex } from './styleTokens'

const rect = { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) }
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1 }
  })
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function callbacks() {
  const events: string[] = []
  return {
    events,
    onBegin: vi.fn(() => { events.push('begin') }),
    onChange: vi.fn((_next: unknown) => { events.push('change') }),
    onFinish: vi.fn(() => { events.push('finish') }),
    onCancel: vi.fn(() => { events.push('cancel') }),
  }
}
type Callbacks = ReturnType<typeof callbacks>
const gradient: UiGradientStop[] = [{ at: 0, color: [0, 0, 0, 1] }, { at: .5, color: [1, 0, 0, .5] }, { at: 1, color: [1, 1, 1, 1] }]
const gradientDefault: UiGradientStop[] = [gradient[0], gradient[2]]
const curves = [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }]
const curvesDefault = [curves[0], curves[2]]
const presets = [{ value: 'linear', label: '直线', curve: [0, 0, 1, 1] as UiCubicBezier }]
interface GraphicCase {
  name: string
  render: (props: Callbacks & { disabled?: boolean }) => ReactElement
  handle: string
  group?: string
  current: unknown
  reset: unknown
}
const graphics: GraphicCase[] = [
  { name: '角度', render: props => <UiAngleDial {...props} label="角度" value={30} defaultValue={0} />, handle: '角度', current: 30, reset: 0 },
  { name: '点位', render: props => <UiPointPad {...props} label="点位" value={{ x: .5, y: .5 }} defaultValue={{ x: .2, y: .3 }} />, handle: '点位', current: { x: .5, y: .5 }, reset: { x: .2, y: .3 } },
  { name: '区间', render: props => <UiRangeSlider {...props} label="区间" value={[.2, .8]} defaultValue={[0, 1]} />, handle: '区间起点', current: [.2, .8], reset: [0, 1] },
  { name: '渐变', render: props => <UiGradientEditor {...props} label="渐变" value={gradient} defaultValue={gradientDefault} />, handle: '渐变色标2', group: '渐变', current: gradient, reset: gradientDefault },
  { name: '色轮', render: props => <UiGradeWheel {...props} label="色轮" value={{ hue: 30, strength: .5, luminance: .2 }} defaultValue={{ hue: 0, strength: 0, luminance: 0 }} />, handle: '色轮', current: { hue: 30, strength: .5, luminance: .2 }, reset: { hue: 0, strength: 0, luminance: .2 } },
  { name: '曲线', render: props => <UiCurveEditor {...props} label="曲线" value={curves} defaultValue={curvesDefault} />, handle: '曲线点2', group: '曲线', current: curves, reset: curvesDefault },
  { name: '缓动', render: props => <UiEasingEditor {...props} label="缓动" value={[.2, .3, .8, .9]} defaultValue={[0, 0, 1, 1]} presets={presets} />, handle: '缓动手柄1', group: '缓动曲线', current: [.2, .3, .8, .9], reset: [0, 0, 1, 1] },
]
function graphicTarget(test: GraphicCase): HTMLElement { return screen.getByRole('slider', { name: test.handle }) }
function graphicSurface(test: GraphicCase): Element {
  const target = graphicTarget(test)
  return test.group ? screen.getByRole('group', { name: test.group }) : test.name === '区间' ? target.parentElement! : target
}

describe.each(graphics)('$name 通用手势契约', test => {
  it('保持受控值，拖动 begin → change → finish，忽略其他指针', () => {
    const props = callbacks(); render(test.render(props))
    const target = graphicTarget(test); const surface = graphicSurface(test)
    const readout = target.getAttribute('aria-valuetext')
    fireEvent.pointerDown(target, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(surface, { clientX: 60, clientY: 40, pointerId: 2 })
    const before = props.onChange.mock.calls.length
    fireEvent.pointerMove(surface, { clientX: 75, clientY: 30, pointerId: 1 })
    expect(props.onChange.mock.calls.length).toBe(before + 1)
    expect(target.getAttribute('aria-valuetext')).toBe(readout)
    fireEvent.pointerUp(surface, { pointerId: 1 })
    expect(props.events[0]).toBe('begin'); expect(props.events.at(-1)).toBe('finish')
    expect(props.events.slice(1, -1).every(entry => entry === 'change')).toBe(true)
    expect(props.onFinish).toHaveBeenCalledTimes(1); expect(props.onCancel).not.toHaveBeenCalled()
    fireEvent.lostPointerCapture(surface, { pointerId: 1 })
    expect(props.onCancel).not.toHaveBeenCalled()
  })
  it.each(['escape', 'capture', 'pointer'] as const)('%s 取消，不在松手后再 finish', cancellation => {
    const props = callbacks(); render(test.render(props))
    const target = graphicTarget(test); const surface = graphicSurface(test)
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 50, clientY: 50 })
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 60, clientY: 40 })
    if (cancellation === 'escape') fireEvent.keyDown(target, { key: 'Escape' })
    else if (cancellation === 'capture') fireEvent.lostPointerCapture(surface, { pointerId: 1 })
    else fireEvent.pointerCancel(surface, { pointerId: 1 })
    fireEvent.pointerUp(surface, { pointerId: 1 })
    expect(props.events[0]).toBe('begin'); expect(props.events.at(-1)).toBe('cancel')
    expect(props.onCancel).toHaveBeenCalledTimes(1); expect(props.onFinish).not.toHaveBeenCalled()
  })
  it('方向键、Shift、Home 与双击复位', () => {
    const props = callbacks(); render(test.render(props))
    const target = graphicTarget(test)
    fireEvent.keyDown(target, { key: 'ArrowRight' })
    const fine = props.onChange.mock.calls.at(-1)?.[0]
    fireEvent.keyDown(target, { key: 'ArrowRight', shiftKey: true })
    expect(props.onChange.mock.calls.at(-1)?.[0]).not.toEqual(fine)
    fireEvent.keyDown(target, { key: 'Home' })
    expect(props.onChange).toHaveBeenLastCalledWith(test.reset)
    fireEvent.doubleClick(graphicSurface(test))
    expect(props.onChange).toHaveBeenLastCalledWith(test.reset)
    expect(props.onBegin).toHaveBeenCalledTimes(4); expect(props.onFinish).toHaveBeenCalledTimes(4)
  })
  it('禁用时不响应指针、键盘或复位', () => {
    const props = callbacks(); render(test.render({ ...props, disabled: true }))
    const target = graphicTarget(test); const surface = graphicSurface(test)
    expect(target.getAttribute('tabindex')).toBe('-1')
    fireEvent.pointerDown(target, { button: 0, pointerId: 1 }); fireEvent.pointerMove(surface, { pointerId: 1, clientX: 90 })
    fireEvent.keyDown(target, { key: 'ArrowRight' }); fireEvent.doubleClick(surface)
    expect(props.onBegin).not.toHaveBeenCalled(); expect(props.onChange).not.toHaveBeenCalled()
  })
})

describe('参数边界与编辑行为', () => {
  it('角度盘夹取自定义范围，wrap 在键盘跨边界时循环', () => {
    const props = callbacks(); const view = render(<UiAngleDial {...props} value={89} min={-90} max={90} label="角度" defaultValue={0} />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight', shiftKey: true }); expect(props.onChange).toHaveBeenLastCalledWith(90)
    view.rerender(<UiAngleDial {...props} value={89} min={-90} max={90} label="角度" wrap />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight', shiftKey: true }); expect(props.onChange).toHaveBeenLastCalledWith(-81)
    view.rerender(<UiAngleDial {...props} value={350} min={0} max={360} label="角度" />)
    fireEvent.pointerDown(screen.getByRole('slider'), { button: 0, clientX: 100, clientY: 40 }); expect(Number(props.onChange.mock.calls.at(-1)?.[0])).toBeGreaterThan(340)
  })
  it('点位 y 向下，允许在画板外拖动，读数保持自定义轴边界', () => {
    const props = callbacks(); render(<UiPointPad {...props} label="点位" value={{ x: .5, y: .5 }} min={{ x: -1, y: -2 }} max={{ x: 2, y: 3 }} aspect={16 / 9} />)
    const target = screen.getByRole('slider')
    expect(Number.parseFloat(target.style.aspectRatio)).toBeCloseTo(16 / 9)
    fireEvent.keyDown(target, { key: 'ArrowDown' }); expect(props.onChange).toHaveBeenLastCalledWith({ x: .5, y: .51 })
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 50, clientY: 50 })
    fireEvent.pointerMove(target, { pointerId: 1, clientX: -500, clientY: 800 }); expect(props.onChange).toHaveBeenLastCalledWith({ x: -1, y: 3 })
  })
  it('区间按 step 对齐，两端不得交叉，键盘触碰上下限', () => {
    const props = callbacks(); render(<UiRangeSlider {...props} label="区间" value={[2, 8]} min={0} max={10} step={2} track="hue" />)
    const a = screen.getByRole('slider', { name: '区间起点' }); const b = screen.getByRole('slider', { name: '区间终点' })
    fireEvent.keyDown(a, { key: 'ArrowRight', shiftKey: true }); expect(props.onChange).toHaveBeenLastCalledWith([8, 8])
    fireEvent.keyDown(b, { key: 'ArrowLeft', shiftKey: true }); expect(props.onChange).toHaveBeenLastCalledWith([2, 2])
    fireEvent.pointerDown(a, { button: 0, pointerId: 1, clientX: 20 }); fireEvent.pointerMove(a.parentElement!, { pointerId: 1, clientX: -500 }); expect(props.onChange).toHaveBeenLastCalledWith([0, 8])
  })
  it('渐变点击插值添加、maxStops 由调用方指定、颜色与透明度保持独立', () => {
    const props = callbacks(); const view = render(<UiGradientEditor {...props} label="渐变" value={gradientDefault} maxStops={3} />)
    fireEvent.pointerDown(screen.getByRole('group'), { button: 0, clientX: 25, clientY: 10 })
    expect(props.onChange).toHaveBeenLastCalledWith([...gradientDefault, { at: .25, color: [.25, .25, .25, 1] }])
    view.rerender(<UiGradientEditor {...props} label="渐变" value={gradient} maxStops={3} />)
    const before = props.onChange.mock.calls.length
    fireEvent.pointerDown(screen.getByRole('group'), { button: 0, clientX: 25, clientY: 10 }); expect(props.onChange).toHaveBeenCalledTimes(before)
    fireEvent.focus(screen.getByRole('slider', { name: '渐变色标2' }))
    fireEvent.change(screen.getByLabelText('渐变色标颜色'), { target: { value: uiParameterHex([0, 1, 0, 1]) } })
    expect(props.onChange).toHaveBeenLastCalledWith([gradient[0], { at: .5, color: [0, 1, 0, .5] }, gradient[2]])
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: '渐变透明度%' }), { key: 'ArrowUp' })
    expect(props.onChange).toHaveBeenLastCalledWith([gradient[0], { at: .5, color: [1, 0, 0, .51] }, gradient[2]])
  })
  it('渐变拖出删除、Delete 保留至少两标，位置夹取', () => {
    const props = callbacks(); const view = render(<UiGradientEditor {...props} label="渐变" value={gradient} />)
    const middle = screen.getByRole('slider', { name: '渐变色标2' }); const surface = screen.getByRole('group')
    fireEvent.pointerDown(middle, { button: 0, pointerId: 1, clientX: 50, clientY: 80 })
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 500, clientY: 200 })
    expect((props.onChange.mock.calls.at(-1)?.[0] as UiGradientStop[])[1].at).toBe(1)
    fireEvent.pointerUp(surface, { pointerId: 1 }); expect(props.onChange).toHaveBeenLastCalledWith(gradientDefault)
    view.rerender(<UiGradientEditor {...props} label="渐变" value={gradientDefault} />)
    props.onChange.mockClear(); fireEvent.keyDown(screen.getByRole('slider', { name: '渐变色标1' }), { key: 'Delete' }); expect(props.onChange).not.toHaveBeenCalled()
  })
  it('色轮圆盘夹取强度，亮度有独立手势与复位', () => {
    const props = callbacks(); render(<UiGradeWheel {...props} label="色轮" value={{ hue: 30, strength: .5, luminance: .2 }} defaultValue={{ hue: 0, strength: 0, luminance: 0 }} />)
    const disc = screen.getByRole('slider', { name: '色轮' }); const light = screen.getByRole('slider', { name: '色轮亮度' })
    fireEvent.pointerDown(disc, { button: 0, pointerId: 1, clientX: 500, clientY: 50 }); expect(props.onChange).toHaveBeenLastCalledWith({ hue: 0, strength: 1, luminance: .2 })
    fireEvent.pointerUp(disc, { pointerId: 1 })
    fireEvent.pointerDown(light, { button: 0, pointerId: 1, clientY: -500 }); expect(props.onChange).toHaveBeenLastCalledWith({ hue: 30, strength: .5, luminance: 1 })
    fireEvent.keyDown(light, { key: 'Escape' }); expect(props.onCancel).toHaveBeenCalledTimes(1)
    fireEvent.doubleClick(light); expect(props.onChange).toHaveBeenLastCalledWith({ hue: 30, strength: .5, luminance: 0 })
  })
  it('曲线使用线性折线，首尾 x 锁定，hue 首尾 y 联动', () => {
    const props = callbacks(); const view = render(<UiCurveEditor {...props} label="曲线" value={curves} kind="hue" channelColor="red" />)
    expect(view.container.querySelector('polyline')?.getAttribute('points')).toBe('0,100 50,50 100,0')
    const first = screen.getByRole('slider', { name: '曲线点1' })
    fireEvent.keyDown(first, { key: 'ArrowRight' }); expect((props.onChange.mock.calls.at(-1)?.[0] as typeof curves)[0].x).toBe(0)
    fireEvent.keyDown(first, { key: 'ArrowUp', shiftKey: true })
    expect(props.onChange).toHaveBeenLastCalledWith([{ x: 0, y: .1 }, curves[1], { x: 1, y: .1 }])
    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 0, clientY: 100 }); fireEvent.pointerMove(screen.getByRole('group'), { pointerId: 1, clientX: 600, clientY: -500 })
    expect(props.onChange).toHaveBeenLastCalledWith([{ x: 0, y: 1 }, curves[1], { x: 1, y: 1 }])
    fireEvent.pointerUp(screen.getByRole('group'), { pointerId: 1 }); expect((props.onChange.mock.calls.at(-1)?.[0] as typeof curves)).toHaveLength(3)
  })
  it('曲线可加点、拖出删除内部点，首尾不可删除', () => {
    const props = callbacks(); render(<UiCurveEditor {...props} label="曲线" value={curves} />)
    const surface = screen.getByRole('group')
    fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 25, clientY: 75 }); expect(props.onChange).toHaveBeenLastCalledWith([curves[0], { x: .25, y: .25 }, curves[1], curves[2]])
    fireEvent.pointerUp(surface, { pointerId: 1 })
    fireEvent.pointerDown(screen.getByRole('slider', { name: '曲线点2' }), { button: 0, pointerId: 1, clientX: 50, clientY: 50 }); fireEvent.pointerMove(surface, { pointerId: 1, clientX: 50, clientY: -50 }); fireEvent.pointerUp(surface, { pointerId: 1 })
    expect(props.onChange).toHaveBeenLastCalledWith(curvesDefault)
    const before = props.onChange.mock.calls.length; fireEvent.keyDown(screen.getByRole('slider', { name: '曲线点1' }), { key: 'Delete' }); expect(props.onChange).toHaveBeenCalledTimes(before)
  })
  it('缓动预设来自调用方，自定义 x 夹取而 y 允许过冲', () => {
    const props = callbacks(); const view = render(<UiEasingEditor {...props} label="缓动" value="linear" presets={presets} />)
    expect(screen.queryByRole('slider')).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } }); expect(props.onChange).toHaveBeenLastCalledWith([0, 0, 1, 1])
    view.rerender(<UiEasingEditor {...props} label="缓动" value={[.2, .3, .8, .9]} presets={presets} />)
    const surface = screen.getByRole('group')
    fireEvent.pointerDown(screen.getByRole('slider', { name: '缓动手柄1' }), { button: 0, pointerId: 1 }); fireEvent.pointerMove(surface, { pointerId: 1, clientX: -500, clientY: -100 })
    const next = props.onChange.mock.calls.at(-1)?.[0] as UiCubicBezier
    expect(next[0]).toBe(0); expect(next[1]).toBeGreaterThan(1)
    fireEvent.pointerUp(surface, { pointerId: 1 }); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'preset-0' } }); expect(props.onChange).toHaveBeenLastCalledWith('linear')
  })
  it('父级读回后实际更新，sm/md 外框跟随宽度且数字尺寸匹配', () => {
    function Controlled() { const [point, setPoint] = useState({ x: .5, y: .5 }); return <UiPointPad {...callbacks()} label="点位" size="md" value={point} onChange={setPoint} /> }
    render(<Controlled />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('X 0.51，Y 0.5')
    expect(screen.getByRole('spinbutton', { name: '点位 X' }).getAttribute('value')).toBe('0.51')
  })
})

describe('随机种子', () => {
  it('聚焦编辑时复位立即同步读数，失焦不能覆盖复位结果', () => {
    function Controlled() { const [seed, setSeed] = useState(5); return <UiSeedInput {...callbacks()} label="种子" value={seed} defaultValue={2} onChange={setSeed} /> }
    render(<Controlled />)
    const input = screen.getByRole('spinbutton', { name: '种子' }) as HTMLInputElement
    act(() => input.focus())
    fireEvent.doubleClick(input)
    expect(input.value).toBe('2')
    act(() => input.blur())
    expect(input.value).toBe('2')
    act(() => input.focus())
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Home' })
    expect(input.value).toBe('2')
    act(() => input.blur()); expect(input.value).toBe('2')
  })
  it('整数夹取、方向键、Shift、Home 和双击复位', () => {
    const props = callbacks(); render(<UiSeedInput {...props} label="种子" value={5} defaultValue={2} min={0} max={10} />)
    const input = screen.getByRole('spinbutton', { name: '种子' })
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true }); expect(props.onChange).toHaveBeenLastCalledWith(10)
    fireEvent.keyDown(input, { key: 'Home' }); expect(props.onChange).toHaveBeenLastCalledWith(2)
    fireEvent.doubleClick(input); expect(props.onChange).toHaveBeenLastCalledWith(2)
    fireEvent.change(input, { target: { value: '3.7' } }); fireEvent.blur(input); expect(props.onChange).toHaveBeenLastCalledWith(4)
  })
  it.each(['finish', 'escape', 'capture'] as const)('数值拖动 %s 有完整手势边界', action => {
    const props = callbacks(); render(<UiSeedInput {...props} label="种子" value={5} />)
    const input = screen.getByRole('spinbutton', { name: '种子' })
    fireEvent.pointerDown(input, { button: 0, pointerId: 1, clientX: 0 }); fireEvent.pointerMove(input, { pointerId: 1, clientX: 30 })
    if (action === 'finish') fireEvent.pointerUp(input, { pointerId: 1 })
    else if (action === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
    else fireEvent.lostPointerCapture(input, { pointerId: 1 })
    expect(props.events).toEqual(['begin', 'change', action === 'finish' ? 'finish' : 'cancel'])
  })
  it('骰子生成不同的新整数，遵守范围；禁用状态不调用', () => {
    const props = callbacks(); const view = render(<UiSeedInput {...props} label="种子" value={5} min={5} max={6} />)
    fireEvent.click(screen.getByRole('button', { name: '种子随机生成' })); expect(props.onChange).toHaveBeenLastCalledWith(6); expect(props.events).toEqual(['begin', 'change', 'finish'])
    view.rerender(<UiSeedInput {...props} label="种子" value={5} disabled />); props.onChange.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '种子随机生成' })); fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Home' }); expect(props.onChange).not.toHaveBeenCalled()
  })
})
