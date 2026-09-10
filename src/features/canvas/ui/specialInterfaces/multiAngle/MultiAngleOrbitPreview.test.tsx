// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MULTI_ANGLE_DISCRETE_VIEW_PRESETS, MULTI_ANGLE_CONTINUOUS_PRESETS, MULTI_ANGLE_FLUX_PRESETS } from '@/features/canvas/capabilities/multiAnglePolicy'
import { MultiAngleOrbitPreview } from './MultiAngleOrbitPreview'

afterEach(cleanup)
describe('直接转动图片块', () => {
  it.each(['discrete', 'continuous', 'flux'] as const)('%s 连续旋转图片，松手提交对应视角一次，取消恢复', kind => {
    const selected = (kind === 'discrete' ? MULTI_ANGLE_DISCRETE_VIEW_PRESETS : kind === 'continuous' ? MULTI_ANGLE_CONTINUOUS_PRESETS : MULTI_ANGLE_FLUX_PRESETS)[0].view
    const onDiscrete = vi.fn(); const onContinuous = vi.fn(); const onFlux = vi.fn()
    const { container } = render(<MultiAngleOrbitPreview views={[selected]} selectedViewId={selected.viewId} sourceImage="photo.png"
      onDiscretePresetChange={onDiscrete} onContinuousChange={onContinuous} onFluxChange={onFlux} />)
    const control = screen.getByRole('application')
    control.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, toJSON: () => ({}) })
    control.setPointerCapture = vi.fn(); control.hasPointerCapture = vi.fn(() => true); control.releasePointerCapture = vi.fn()
    const callback = kind === 'discrete' ? onDiscrete : kind === 'continuous' ? onContinuous : onFlux
    const orientation = (): string => container.querySelector('svg')!.getAttribute('data-block-azimuth')!
    const original = orientation()
    const image = container.querySelector('img')!
    const move = (id: number): void => {
      fireEvent.pointerDown(control, { pointerId: id, button: 0, clientX: 100, clientY: 100 })
      for (let i = 0; i < 60; i++) fireEvent.pointerMove(control, { pointerId: id,
        clientX: kind === 'discrete' ? 198 : 50, clientY: kind === 'discrete' ? 100 : 150 })
    }
    move(1)
    const before = orientation()
    fireEvent.pointerMove(control, { pointerId: 1, clientX: kind === 'discrete' ? 199 : 51, clientY: kind === 'discrete' ? 100 : 151 })
    expect(orientation()).not.toBe(before)
    expect(container.querySelector('img')).toBe(image)
    expect(callback).not.toHaveBeenCalled()
    expect(control.textContent).toBe('')
    fireEvent.pointerUp(control, { pointerId: 1 })
    expect(callback).toHaveBeenCalledTimes(1)
    if (kind === 'discrete') expect(callback).toHaveBeenCalledWith('back')
    if (kind === 'continuous') expect(callback).toHaveBeenCalledWith({ yawControlDeg: 0, elevationDeg: 30 })
    if (kind === 'flux') expect(callback).toHaveBeenCalledWith({ horizontalAngleDeg: 90, verticalAngleDeg: 15 })
    move(2)
    fireEvent.pointerCancel(control, { pointerId: 2 })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(orientation()).toBe(original)
  })
})
