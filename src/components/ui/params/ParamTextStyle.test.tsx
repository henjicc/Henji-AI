// @vitest-environment jsdom
import { APP_ACCENT_HEX } from '@/core/theme/colorTokens'
import { useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ParamField, type ParamGesture } from './ParamField'
import { codeParameterFields } from './fieldSpec'
import { textStyleSchema } from '@/core/imaging/vectorContent/text'
import type { CodeParameterValue } from '@/core/imaging/parameterTypes'
import { parseCodeMaterialV3Parameters } from '@/core/videoEdit/codeMaterial/parameterTypes'

afterEach(cleanup)

it('文字样式参数复用文字面板，原子修改与连续手势共用宿主撤销', () => {
  const style = textStyleSchema.parse({ fontSize: 64 })
  const field = codeParameterFields([{ key: 'style', type: 'textStyle', title: '标题样式', description: '', animatable: false, default: style }])[0]
  let active = false
  const begin = vi.fn(() => { active = true })
  const finish = vi.fn(() => { active = false })
  const cancel = vi.fn(() => { active = false })
  const atomic = vi.fn(); const write = vi.fn()
  function View() {
    const [value, setValue] = useState<CodeParameterValue>(style)
    const gesture: ParamGesture = { begin, finish, cancel, active: () => active, atomic: next => { atomic(next); setValue(next) }, write: next => { write(next); setValue(next) } }
    return <ParamField field={field} value={value} gesture={gesture} />
  }
  const view = render(<View />)
  fireEvent.click(view.getByLabelText('添加描边'))
  expect(atomic.mock.lastCall![0]).toMatchObject({ fontSize: 64, strokes: [{ width: 2 }] })
  fireEvent.focus(view.getByLabelText('文字填充颜色'))
  fireEvent.change(view.getByLabelText('文字填充颜色'), { target: { value: APP_ACCENT_HEX } })
  expect(begin).toHaveBeenCalled()
  expect(write.mock.lastCall![0].fill.color).toBe(APP_ACCENT_HEX)
  fireEvent.blur(view.getByLabelText('文字填充颜色'))
  expect(finish).toHaveBeenCalled()
  fireEvent.click(view.getByLabelText('删除描边1'))
  expect(atomic.mock.lastCall![0].strokes).toEqual([])
  expect(view.queryByLabelText('添加阴影')).toBeNull()
})

it('数据表内改一项文案保留相邻项和样式，沿用同一参数手势', () => {
  const declarations = parseCodeMaterialV3Parameters({ nodes: { type: 'table', title: '节点', fields: {
    title: { type: 'text', title: '文案', default: '', maxLength: 200 }, style: { type: 'textStyle', title: '文字样式', default: { fontSize: 48 } },
  }, default: [{ title: '甲' }, { title: '乙' }] } }, {})
  const field = codeParameterFields(declarations)[0]
  const changed = vi.fn(); const begin = vi.fn(); const finish = vi.fn()
  function View() {
    const [value, setValue] = useState<CodeParameterValue>(declarations[0].default)
    const write = (next: CodeParameterValue) => { setValue(next); changed(next) }
    return <ParamField field={field} value={value} gesture={{ begin, finish, cancel: vi.fn(), active: () => true, write, atomic: write }} />
  }
  const view = render(<View />)
  const input = view.getByLabelText('节点第 2 项文案')
  fireEvent.focus(input); fireEvent.change(input, { target: { value: '新的乙' } }); fireEvent.blur(input)
  expect(changed.mock.lastCall![0]).toMatchObject([{ title: '甲', style: { fontSize: 48 } }, { title: '新的乙', style: { fontSize: 48 } }])
  expect(begin).toHaveBeenCalled(); expect(finish).toHaveBeenCalled()
})
