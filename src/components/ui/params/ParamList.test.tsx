/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ParamList } from './ParamList'
import { UiFieldLayoutContext } from '../fieldLayout'
import type { ParamFieldSpec } from './fieldSpec'

afterEach(cleanup)
const field = (key: string): ParamFieldSpec => ({ key, title: key, type: 'number', default: 100, min: 0, max: 100, step: 1, unit: '%', source: 'builtin', bindingKeys: [key], animatable: false })

it('同一参数列表在蒙版与图层字段间切换时，新字段等待订阅发布且显示当前值', () => {
  const renderControl = (spec: ParamFieldSpec, value: unknown) => <span>{`${spec.key}: ${String(value)}`}</span>
  const view = render(<ParamList fields={[field('density')]} values={{ density: 100 }} contextKey="mask" renderControl={renderControl} />)
  expect(screen.getByText('density: 100')).toBeTruthy()
  view.rerender(<ParamList fields={[field('opacity'), field('fillOpacity')]} values={{ opacity: 75, fillOpacity: 50 }} contextKey="layer" renderControl={renderControl} />)
  expect(screen.getByText('opacity: 75')).toBeTruthy()
  expect(screen.getByText('fillOpacity: 50')).toBeTruthy()
  expect(screen.queryByText('density: 100')).toBeNull()
  view.rerender(<ParamList fields={[field('density')]} values={{ density: 25 }} contextKey="mask" renderControl={renderControl} />)
  expect(screen.getByText('density: 25')).toBeTruthy()
})

it('属性面板里只有列出的参数显示已改标记，没有修改记录的参数不显示', () => {
  const view = render(<UiFieldLayoutContext.Provider value="property"><ParamList fields={[field('a'), field('b')]} values={{ a: 1, b: 2 }} modified={{ a: '用户手动改过' }} renderControl={spec => <span>{spec.key}</span>} /></UiFieldLayoutContext.Provider>)
  expect(view.container.querySelectorAll('[data-ui-form-row-modified]')).toHaveLength(1)
  expect(screen.getByRole('img', { name: '用户手动改过' })).toBeTruthy()
  view.rerender(<UiFieldLayoutContext.Provider value="property"><ParamList fields={[field('a'), field('b')]} values={{ a: 1, b: 2 }} renderControl={spec => <span>{spec.key}</span>} /></UiFieldLayoutContext.Provider>)
  expect(view.container.querySelectorAll('[data-ui-form-row-modified]')).toHaveLength(0)
})
