// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MULTI_ANGLE_DISCRETE_VIEW_PRESETS, MULTI_ANGLE_CONTINUOUS_PRESETS, MULTI_ANGLE_FLUX_PRESETS } from '@/features/canvas/capabilities/multiAnglePolicy'
import { MultiAngleOrbitPreview } from './MultiAngleOrbitPreview'
import { multiAngleMarkerPosition, projectMultiAnglePoint } from './multiAngleOrbitGeometry'

afterEach(cleanup)
describe('多角度局部吸附预览', () => {
  it.each(['discrete', 'continuous', 'flux'] as const)('%s 拖动只更新局部，松手提交一次，取消不提交', kind => {
    const selected = (kind === 'discrete' ? MULTI_ANGLE_DISCRETE_VIEW_PRESETS : kind === 'continuous'
      ? MULTI_ANGLE_CONTINUOUS_PRESETS : MULTI_ANGLE_FLUX_PRESETS)[0].view
    const onDiscrete = vi.fn(); const onContinuous = vi.fn(); const onFlux = vi.fn()
    const { container } = render(<MultiAngleOrbitPreview views={[selected]} selectedViewId={selected.viewId}
      onDiscretePresetChange={onDiscrete} onContinuousChange={onContinuous} onFluxChange={onFlux} />)
    const control = screen.getByRole('application')
    control.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, toJSON: () => ({}) })
    control.setPointerCapture = vi.fn(); control.hasPointerCapture = vi.fn(() => true); control.releasePointerCapture = vi.fn()
    const stop = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.find(item => item.view.preset === 'back')!.view
    const p = projectMultiAnglePoint(multiAngleMarkerPosition(stop))
    const callback = kind === 'discrete' ? onDiscrete : kind === 'continuous' ? onContinuous : onFlux
    const move = (id: number): void => {
      fireEvent.pointerDown(control, { pointerId: id, button: 0, clientX: 100, clientY: 100 })
      for (let i = 0; i < 60; i++) fireEvent.pointerMove(control, { pointerId: id,
        clientX: kind === 'discrete' ? p.x * 2 : 150, clientY: kind === 'discrete' ? p.y * 2 : 50 })
    }
    move(1)
    const marker = (): number[] => {
      const circle = container.querySelector('[data-camera-depth] circle')!
      return ['cx', 'cy'].map(key => Number(circle.getAttribute(key)))
    }
    const before = marker()
    fireEvent.pointerMove(control, { pointerId: 1,
      clientX: kind === 'discrete' ? p.x * 2 + 1 : 151,
      clientY: kind === 'discrete' ? p.y * 2 + 1 : 51 })
    expect(marker()).not.toEqual(before)
    if (kind === 'discrete') {
      expect(marker()[0]).toBeCloseTo(p.x + 0.5)
      expect(marker()[1]).toBeCloseTo(p.y + 0.5)
    }
    expect(callback).not.toHaveBeenCalled()
    expect(container.querySelector('[data-snap-active="true"]')).not.toBeNull()
    fireEvent.pointerUp(control, { pointerId: 1 })
    expect(callback).toHaveBeenCalledTimes(1)
    if (kind === 'discrete') expect(callback).toHaveBeenCalledWith('back')
    if (kind === 'continuous') expect(callback).toHaveBeenCalledWith({ yawControlDeg: 0, verticalControl: -0.5 })
    if (kind === 'flux') expect(callback).toHaveBeenCalledWith({ horizontalAngleDeg: 90, verticalAngleDeg: 15 })
    move(2)
    fireEvent.pointerCancel(control, { pointerId: 2 })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-snap-active="true"]')).toBeNull()
  })
})
