/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import '@/i18n/config'
import { NodeGenerationError } from './NodeGenerationError'
const showAlert = vi.hoisted(() => vi.fn())
vi.mock('@/stores/alertDialogStore', () => ({ showAlertDialog: showAlert }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('失败详情用正式按钮，点击/键盘只开一次详情且不冒泡到画布', () => {
  const parent = vi.fn()
  const view = render(<div onClick={parent}><NodeGenerationError message="详细失败原因" /></div>)
  const button = view.getByRole('button')
  expect(button.tagName).toBe('BUTTON')
  fireEvent.click(button)
  expect(showAlert).toHaveBeenCalledTimes(1); expect(parent).not.toHaveBeenCalled()
  expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ detail: '详细失败原因' }))
  fireEvent.keyDown(button, { key: ' ' })
  expect(showAlert).toHaveBeenCalledTimes(2)
})
