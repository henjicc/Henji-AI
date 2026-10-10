/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ParamList } from './ParamList'
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
