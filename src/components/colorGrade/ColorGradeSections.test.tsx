/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ImagingParam } from '@/core/imaging/parameterDefinition'
import { ColorGradeSections, type ColorGradeSectionsHost } from './ColorGradeSections'

afterEach(cleanup)
function setup(values: Record<string, unknown> = {}) {
  const rendered: string[][] = []
  const host: ColorGradeSectionsHost = {
    values, resetParams: vi.fn(), applyParams: vi.fn(), renderLut: stage => <span>{`LUT ${stage}`}</span>,
    renderRows: (params: readonly ImagingParam[]) => { rendered.push(params.map(param => param.key)); return <span>{params.map(param => param.key).join(',')}</span> },
  }
  return { host, rendered, view: render(<ColorGradeSections host={host} />) }
}

it('只有改过的分区出现重置，重置写回该分区全部参数', () => {
  const { host, view } = setup({ exposure: .5 })
  expect(view.queryByRole('button', { name: '重置混色器' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '重置基本' }))
  const params = vi.mocked(host.resetParams).mock.calls[0][0].map(param => param.key)
  expect(params).toEqual(expect.arrayContaining(['temperature_kelvin', 'tint', 'exposure', 'vibrance']))
})

it('混色器按调整类别只列当前类别的颜色；一级模式隐藏分级混合与平衡', () => {
  const { rendered, view } = setup({ wheel_mode: 'primary' })
  fireEvent.click(view.getByRole('button', { name: '混色器' }))
  expect(rendered.at(-1)?.length).toBeGreaterThan(0)
  expect(rendered.at(-1)?.every(key => key.startsWith('mixer_') && key.endsWith('_saturation'))).toBe(true)
  fireEvent.click(view.getByRole('radio', { name: '明亮度' }))
  expect(rendered.at(-1)?.every(key => key.endsWith('_luminance'))).toBe(true)
  rendered.length = 0
  fireEvent.click(view.getByRole('button', { name: '色彩分级' }))
  expect(rendered.flat()).toContain('wheel_mode'); expect(rendered.flat()).not.toContain('grade_blending')
  expect(rendered.flat()).toEqual(expect.arrayContaining(['global_hue', 'global_strength', 'global_luminance']))
})
