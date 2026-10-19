// @vitest-environment jsdom
import { APP_ACCENT_HEX } from '@/core/theme/colorTokens'
import { useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ParamField, type ParamGesture } from './ParamField'
import { codeParameterFields } from './fieldSpec'
import { textStyleSchema } from '@/core/imaging/vectorContent/text'
import type { CodeParameterValue } from '@/core/imaging/parameterTypes'

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
