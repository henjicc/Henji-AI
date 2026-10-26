// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AudioSpectralEditor, type AudioSpectralEditorProps } from './AudioSpectralEditor'

vi.mock('@/components/audio/SpectrogramView', () => ({ SpectrogramView: () => null }))
vi.mock('@/components/waveform/WaveformView', () => ({ WaveformView: () => null }))
vi.mock('@/components/ui', () => ({ UiEmpty: () => null, UiError: () => null, UiLoading: () => null }))

beforeEach(() => {
  class Pointer extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 }
  }
  vi.stubGlobal('PointerEvent', Pointer)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => true },
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function editor() {
  let frame = 0
  const seek = vi.fn((next: number) => { frame = next })
  const start = vi.fn()
  const move = vi.fn((next: number) => { frame = next })
  const end = vi.fn()
  const step = vi.fn((next: number) => { frame = next })
  const props: AudioSpectralEditorProps = {
    sampleRate: 48000, durationFrames: 480000, view: { start: 0, end: 480000 },
    waveform: { status: 'idle' }, spectrogramStatus: 'idle', display: 'waveform', tool: 'time', brushPixels: 8,
    playhead: { current: () => frame, subscribe: () => () => undefined },
    onViewChange: vi.fn(), onSeek: seek, onScrubStart: start, onScrubMove: move, onScrubEnd: end, onScrubStep: step,
    selection: null, onSelectionChange: vi.fn(), spectralSelection: null, onSpectralSelectionChange: vi.fn(), onBrushStroke: vi.fn(), cutRanges: [], repairs: [],
  }
  const view = render(<AudioSpectralEditor {...props} />)
  const handle = view.getByRole('slider', { name: '播放位置' })
  const ruler = handle.parentElement!
  vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 30, width: 1000, height: 30, toJSON: () => ({}) })
  return { ...view, handle, ruler, seek, start, move, end, step }
}

it('单击与点击范围内的微小移动只跳转，不启动擦洗', () => {
  const view = editor()
  fireEvent.pointerDown(view.ruler, { button: 0, clientX: 100, pointerId: 1 })
  fireEvent.pointerMove(view.ruler, { clientX: 101, pointerId: 1 })
  fireEvent.pointerUp(view.ruler, { clientX: 101, pointerId: 1 })
  expect(view.seek.mock.calls).toEqual([[48000]])
  expect(view.start).not.toHaveBeenCalled()
  expect(view.move).not.toHaveBeenCalled()
  expect(view.end).not.toHaveBeenCalled()
})

it.each(['ruler', 'handle'] as const)('拖动 %s 只发明确开始、位置变化和结束回调，反拖仍传新位置', target => {
  const view = editor()
  fireEvent.pointerDown(view[target], { button: 0, clientX: 100, pointerId: 1 })
  fireEvent.pointerMove(view.ruler, { clientX: 200, pointerId: 2 })
  expect(view.move).not.toHaveBeenCalled()
  fireEvent.pointerMove(view.ruler, { clientX: 200, pointerId: 1 })
  fireEvent.pointerMove(view.ruler, { clientX: 200, pointerId: 1 })
  fireEvent.pointerMove(view.ruler, { clientX: 150, pointerId: 1 })
  fireEvent.pointerUp(view.ruler, { clientX: 150, pointerId: 1 })
  expect(view.start.mock.calls).toEqual([[48000]])
  expect(view.move.mock.calls).toEqual([[96000], [72000]])
  expect(view.seek).toHaveBeenCalledTimes(1)
  expect(view.end).toHaveBeenCalledTimes(1)
})

it.each(['cancel', 'lost', 'unmount'])('手势 %s 时结束擦洗，释放捕获不重复提交', reason => {
  const view = editor()
  fireEvent.pointerDown(view.ruler, { button: 0, clientX: 100, pointerId: 1 })
  fireEvent.pointerMove(view.ruler, { clientX: 200, pointerId: 1 })
  if (reason === 'unmount') view.unmount()
  else {
    if (reason === 'cancel') fireEvent.pointerCancel(view.ruler, { pointerId: 1 })
    fireEvent.lostPointerCapture(view.ruler, { pointerId: 1 })
    fireEvent.pointerUp(view.ruler, { pointerId: 1 })
  }
  expect(view.end).toHaveBeenCalledTimes(1)
})

it('左右键发单段试听，Home/End 只跳转，边界位置不重复出声', () => {
  const view = editor()
  fireEvent.keyDown(view.handle, { key: 'ArrowLeft' })
  expect(view.step).not.toHaveBeenCalled()
  fireEvent.keyDown(view.handle, { key: 'ArrowRight' })
  fireEvent.keyDown(view.handle, { key: 'ArrowRight', shiftKey: true })
  fireEvent.keyDown(view.handle, { key: 'ArrowLeft' })
  expect(view.step.mock.calls).toEqual([[4800], [52800], [48000]])
  fireEvent.keyDown(view.handle, { key: 'Home' })
  fireEvent.keyDown(view.handle, { key: 'End' })
  expect(view.seek.mock.calls).toEqual([[0], [480000]])
  expect(view.start).not.toHaveBeenCalled()
})

it('拖动删除 / 静音区间的边缘：从哪种里面抓就改哪种，外拖扩、拖到另一边就取消整段，靠近边缘会吸附', () => {
  const onCutEdgeEdit = vi.fn()
  // 1000 像素对应 480000 帧：删除 200–300 像素，静音 300–400 像素，两段相接
  const cutRanges: AudioSpectralEditorProps['cutRanges'] = [{ start: 96000, end: 144000, mode: 'delete' }, { start: 144000, end: 192000, mode: 'mute' }]
  const props: AudioSpectralEditorProps = {
    sampleRate: 48000, durationFrames: 480000, view: { start: 0, end: 480000 }, waveform: { status: 'idle' }, spectrogramStatus: 'idle', display: 'waveform', tool: 'time', brushPixels: 8,
    playhead: { current: () => 0, subscribe: () => () => undefined }, onViewChange: vi.fn(), onSeek: vi.fn(),
    selection: null, onSelectionChange: vi.fn(), spectralSelection: null, onSpectralSelectionChange: vi.fn(), onBrushStroke: vi.fn(), cutRanges, repairs: [], onCutEdgeEdit, snapEnabled: true,
  }
  const view = render(<AudioSpectralEditor {...props} />)
  const area = view.getByRole('application', { name: '音频波形与频谱编辑区' })
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 300, width: 1000, height: 300, toJSON: () => ({}) })
  const drag = (from: number, to: number): void => {
    fireEvent.pointerDown(area, { button: 0, clientX: from, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(area, { clientX: to, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(area, { clientX: to, clientY: 50, pointerId: 1 })
  }
  // 在红色里贴着相接处抓：改删除；往右拉进静音，删除叠上去
  drag(298, 350)
  expect(onCutEdgeEdit).toHaveBeenLastCalledWith({ range: { start: 144000, end: 168000 }, mode: 'delete', action: 'add' })
  // 在蓝色里贴着相接处抓：改静音；拉到另一边附近吸附过去，整段静音取消
  drag(302, 396)
  expect(onCutEdgeEdit).toHaveBeenLastCalledWith({ range: { start: 144000, end: 192000 }, mode: 'mute', action: 'remove' })
  // 删除的左边缘往左拉：扩大删除
  drag(201, 150)
  expect(onCutEdgeEdit).toHaveBeenLastCalledWith({ range: { start: 72000, end: 96000 }, mode: 'delete', action: 'add' })
  // 离边缘远的地方照常是时间选区，不改区间
  onCutEdgeEdit.mockClear(); drag(600, 700)
  expect(onCutEdgeEdit).not.toHaveBeenCalled()
  // 吸附关着：拖到另一边附近也停在指针位置，无极调节
  view.rerender(<AudioSpectralEditor {...props} snapEnabled={false} />)
  drag(302, 396)
  expect(onCutEdgeEdit).toHaveBeenLastCalledWith({ range: { start: 144000, end: 190080 }, mode: 'mute', action: 'remove' })
})

it('中键点口水音位置切换处理，点删除区间取消它；中键拖动照常平移', () => {
  const onMarkToggle = vi.fn(), onCutEdgeEdit = vi.fn(), onViewChange = vi.fn()
  const props: AudioSpectralEditorProps = {
    sampleRate: 48000, durationFrames: 480000, view: { start: 0, end: 480000 },
    waveform: { status: 'idle' }, spectrogramStatus: 'idle', display: 'waveform', tool: 'time', brushPixels: 8,
    playhead: { current: () => 0, subscribe: () => () => undefined },
    onViewChange, onSeek: vi.fn(), selection: null, onSelectionChange: vi.fn(), spectralSelection: null, onSpectralSelectionChange: vi.fn(), onBrushStroke: vi.fn(), repairs: [],
    cutRanges: [{ start: 240000, end: 288000, mode: 'delete' }], marks: [{ start: 48000, end: 48100 }], onMarkToggle, onCutEdgeEdit,
  }
  const view = render(<AudioSpectralEditor {...props} />)
  const content = view.getByRole('application', { name: '音频波形与频谱编辑区' })
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 300, width: 1000, height: 300, toJSON: () => ({}) })
  const click = (clientX: number, upX = clientX) => {
    fireEvent.pointerDown(content, { button: 1, clientX, clientY: 50, pointerId: 3 })
    fireEvent.pointerUp(content, { button: 1, clientX: upX, clientY: 50, pointerId: 3 })
  }
  // 口水音只有 0.2 像素宽，点在旁边 4 像素也算
  click(104)
  expect(onMarkToggle).toHaveBeenCalledWith({ start: 48000, end: 48100 })
  click(550)
  expect(onCutEdgeEdit).toHaveBeenCalledWith({ range: { start: 240000, end: 288000 }, mode: 'delete', action: 'remove' })
  onMarkToggle.mockClear(); onCutEdgeEdit.mockClear()
  fireEvent.pointerDown(content, { button: 1, clientX: 550, clientY: 50, pointerId: 4 })
  fireEvent.pointerMove(content, { clientX: 650, clientY: 50, pointerId: 4 })
  fireEvent.pointerUp(content, { button: 1, clientX: 650, clientY: 50, pointerId: 4 })
  expect(onCutEdgeEdit).not.toHaveBeenCalled()
  expect(onMarkToggle).not.toHaveBeenCalled()
})
