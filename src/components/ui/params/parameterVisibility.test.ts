// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, expect, it } from 'vitest'
import { ParamList } from './ParamList'
import { UiFieldLayoutContext } from '../fieldLayout'
import { builtinParameterFields, codeParameterFields, type ParamFieldSpec } from './fieldSpec'
import { parseCodeMaterialV3Parameters } from '@/core/videoEdit/codeMaterial/parameterTypes'

afterEach(cleanup)

it.each(['form', 'property'] as const)('%s 共用参数面板在任一 all 条件变化时更新作者与内置行', layout => {
  const visibleWhen = { all: [{ param: 'mode', equals: 'lens' }, { param: 'range', notEquals: 'full' }] }
  const declarations = parseCodeMaterialV3Parameters({
    mode: { type: 'choice', title: '方式', options: ['lens', 'spin'], default: 'lens' },
    range: { type: 'choice', title: '范围', options: ['full', 'tilt'], default: 'full' },
    width: { type: 'number', title: '宽度', default: 30, min: 0, max: 100, step: 1, visibleWhen },
  }, {}, 8)
  const builtin = builtinParameterFields([{ key: 'width', type: 'number', name: '宽度', description: '', default: 30, min: 0, max: 100, step: 1, unit: 'percent', visibleWhen }])
  for (const fields of [codeParameterFields(declarations), builtin]) {
    const panel = (mode: string, range: string) => createElement(UiFieldLayoutContext.Provider, { value: layout }, createElement(ParamList, { fields, values: { mode, range, width: 30 }, renderControl: (field: ParamFieldSpec) => createElement('span', { 'data-testid': field.key }, field.title) }))
    const view = render(panel('lens', 'full'))
    expect(view.queryByTestId('width')).toBeNull()
    view.rerender(panel('lens', 'tilt')); expect(view.queryByTestId('width')).not.toBeNull()
    view.rerender(panel('spin', 'tilt')); expect(view.queryByTestId('width')).toBeNull()
    view.unmount()
  }
})
