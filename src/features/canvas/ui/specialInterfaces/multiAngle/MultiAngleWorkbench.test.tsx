// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultMultiAngleConfig, createMultiAngleBatchPlan, type MultiAngleConfigV1 } from '@/features/canvas/capabilities/multiAnglePolicy'
import { MultiAngleWorkbench } from './MultiAngleSpecialEditor'

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}))
afterEach(cleanup)

describe('输出槽位与方位编辑', () => {
  it('方位仅替换选中槽位；加号才新增并选中，重复方位独立输出，达到上限仍可修改', () => {
    let current = createDefaultMultiAngleConfig('discrete-v1')
    function Harness(): JSX.Element {
      const [config, setConfig] = useState(current)
      return <MultiAngleWorkbench config={config} sourceImage={null} onConfigChange={next => { current = next; setConfig(next) }} />
    }
    const { container, getByRole } = render(<Harness />)
    const slots = (): HTMLElement => container.querySelector('[data-multi-angle-output-slots]')!
    const directions = (): HTMLElement => container.querySelector('[data-multi-angle-direction-options]')!
    const pick = (label: string): void => { fireEvent.click(within(directions()).getByRole('button', { name: label })) }
    const add = getByRole('button', { name: 'node.multiAngleEditor.addView' })
    const originalId = current.views[0].viewId
    pick('左侧面')
    expect(current.views).toHaveLength(1)
    expect(current.views[0]).toMatchObject({ viewId: originalId, preset: 'left_side' })
    fireEvent.click(add)
    expect(current.views).toHaveLength(2)
    const secondId = current.views[1].viewId
    expect(secondId).not.toBe(originalId)
    expect(within(slots()).getAllByRole('button')[1].getAttribute('aria-pressed')).toBe('true')
    pick('背面')
    expect(current.views[1]).toMatchObject({ viewId: secondId, preset: 'back' })
    expect(current.views[0]).toMatchObject({ preset: 'left_side' })
    fireEvent.click(within(slots()).getAllByRole('button')[0])
    pick('背面')
    expect(current.views.map(view => view.viewId)).toEqual([originalId, secondId])
    expect(createMultiAngleBatchPlan(current, 'source.png')).toHaveLength(2)
    const stage = getByRole('application')
    stage.setPointerCapture = vi.fn()
    const top = container.querySelector('[data-multi-angle-direction="top_down"]')!
    fireEvent.pointerDown(top, { button: 0, pointerId: 1 })
    fireEvent.click(top)
    expect(stage.setPointerCapture).not.toHaveBeenCalled()
    expect(current.views[0]).toMatchObject({ viewId: originalId, preset: 'top_down' })
    expect(current.views[1]).toMatchObject({ viewId: secondId, preset: 'back' })
    fireEvent.keyDown(stage, { key: 'Home' })
    expect(current.views[0]).toMatchObject({ viewId: originalId, preset: 'front' })
    while (current.views.length < 6) fireEvent.click(add)
    expect((add as HTMLButtonElement).disabled).toBe(true)
    pick('仰视')
    expect(current.views[5]).toMatchObject({ preset: 'bottom_up' })
    expect(current.views).toHaveLength(6)
    fireEvent.click(getByRole('button', { name: 'node.multiAngleEditor.removeView' }))
    expect(current.views).toHaveLength(5)
    expect((add as HTMLButtonElement).disabled).toBe(false)
  })

  it.each(['continuous-v1', 'flux-native-v1'] as const)('%s 新增后选中独立编号，重复点击控制方式不重置', profile => {
    let current: MultiAngleConfigV1 = createDefaultMultiAngleConfig(profile)
    function Harness(): JSX.Element {
      const [config, setConfig] = useState(current)
      return <MultiAngleWorkbench config={config} sourceImage={null} onConfigChange={next => { current = next; setConfig(next) }} />
    }
    const { getByRole, container } = render(<Harness />)
    if (profile === 'flux-native-v1') fireEvent.change(container.querySelector('input[type="range"]')!, { target: { value: 360 } })
    fireEvent.click(getByRole('button', { name: 'node.multiAngleEditor.addView' }))
    expect(createMultiAngleBatchPlan(current, 'source.png')).toHaveLength(2)
    const added = current.views[1]
    expect(added.viewId).not.toBe(current.views[0].viewId)
    fireEvent.change(container.querySelector('input[type="range"]')!, { target: { value: 12 } })
    expect(current.views[1]).toMatchObject(profile === 'continuous-v1' ? { yawControlDeg: 12 } : { horizontalAngleDeg: 12 })
    fireEvent.click(getByRole('button', { name: new RegExp(`profiles.${profile === 'continuous-v1' ? 'continuous' : 'flux'}.title`) }))
    expect(current.views).toHaveLength(2)
    expect(current.views[1].viewId).toBe(added.viewId)
  })
})
