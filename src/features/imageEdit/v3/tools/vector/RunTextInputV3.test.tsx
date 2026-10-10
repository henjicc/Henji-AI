/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RunTextInputV3 } from './RunTextInputV3'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })
const input = (): HTMLElement => screen.getByRole('textbox', { name: '图层文字内容' })
const pause = (ms: number): void => { act(() => vi.advanceTimersByTime(ms)) }

it('连续输入在停顿合并成一次提交，失焦不重复，下一段输入另成一步', () => {
  const commit = vi.fn(() => true)
  const result = render(<RunTextInputV3 value="原文" onCommit={commit} />)
  fireEvent.change(input(), { target: { value: '第一' } }); pause(200)
  fireEvent.change(input(), { target: { value: '第一段' } }); pause(399)
  expect(commit).not.toHaveBeenCalled()
  pause(1); expect(commit).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenLastCalledWith('第一段')
  fireEvent.blur(input()); expect(commit).toHaveBeenCalledTimes(1)
  result.rerender(<RunTextInputV3 value="第一段" onCommit={commit} />)
  fireEvent.change(input(), { target: { value: '第一段第二段' } })
  fireEvent.blur(input()); pause(400)
  expect(commit).toHaveBeenCalledTimes(2)
  expect(commit).toHaveBeenLastCalledWith('第一段第二段')
})

it('IME 长时间候选和候选 Enter 均不提交，多个组合段在停顿合并', () => {
  const commit = vi.fn(() => true)
  render(<RunTextInputV3 value="" onCommit={commit} />)
  fireEvent.compositionStart(input())
  fireEvent.change(input(), { target: { value: '中文' } }); pause(1000)
  fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true, isComposing: true })
  expect(commit).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input()); pause(100)
  fireEvent.compositionStart(input()); fireEvent.change(input(), { target: { value: '中文标题' } })
  pause(1000); expect(commit).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input()); pause(400)
  expect(commit).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenLastCalledWith('中文标题')
})

it('IME 中失焦等待组合完成，失败保留草稿供确认重试', () => {
  const commit = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
  render(<RunTextInputV3 value="" onCommit={commit} />)
  fireEvent.compositionStart(input()); fireEvent.change(input(), { target: { value: '候选' } })
  fireEvent.blur(input()); pause(1000); expect(commit).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input(), { target: { value: '最终文字' } })
  expect(commit).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenLastCalledWith('最终文字')
  fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
  expect(commit).toHaveBeenCalledTimes(2)
})

it('切换输入目标或外部内容更新取消迟到提交，不把旧草稿写到新目标', () => {
  const commit = vi.fn(() => true)
  const result = render(<RunTextInputV3 key="first" value="旧内容" onCommit={commit} />)
  fireEvent.change(input(), { target: { value: '旧目标草稿' } })
  result.rerender(<RunTextInputV3 key="second" value="新目标" onCommit={commit} />)
  pause(400); expect(commit).not.toHaveBeenCalled()
  fireEvent.change(input(), { target: { value: '新目标草稿' } })
  result.rerender(<RunTextInputV3 key="second" value="外部修改" onCommit={commit} />)
  pause(400); expect(commit).not.toHaveBeenCalled()
  expect((input() as HTMLTextAreaElement).value).toBe('外部修改')
})
