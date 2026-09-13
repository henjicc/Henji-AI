/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { EmbeddedAgentMessage } from '@/core/assistant/embeddedAgent'
import { EmbeddedTranscript } from './EmbeddedTranscript'

afterEach(cleanup)
const process: EmbeddedAgentMessage[] = [
  { id: 'user', role: 'user', text: '帮我生成图片' },
  { id: 'thinking', role: 'assistant', kind: 'process', text: '先核对参考图。' },
  { id: 'tool', role: 'assistant', kind: 'tool', text: '读取参考图', status: 'completed' },
]
it('过程实时可见，最终回答出现后自动收起，仍可主动展开', () => {
  const toggle = vi.fn()
  const view = render(<EmbeddedTranscript messages={process} onToggle={toggle} />)
  expect(screen.getByText('先核对参考图。')).toBeTruthy()
  expect(screen.getByText('读取参考图')).toBeTruthy()
  expect(view.container.querySelector('[data-embedded-user-message]')?.className).toContain('justify-end')
  view.rerender(<EmbeddedTranscript messages={[...process, { id: 'final', role: 'assistant', kind: 'answer', text: '图片已生成。' }]} onToggle={toggle} />)
  expect(screen.queryByText('先核对参考图。')).toBeNull()
  expect(screen.getByText('图片已生成。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '查看过程' }))
  expect(toggle).toHaveBeenCalledOnce()
  expect(screen.getByText('读取参考图')).toBeTruthy()
})
it('历史默认折叠，后续失败或停止的过程仍可见，不冒充最终结论', () => {
  const messages: EmbeddedAgentMessage[] = [...process, { id: 'final', role: 'assistant', kind: 'answer', text: '第一轮完成' },
    { id: 'next', role: 'user', text: '再做一张' }, { id: 'failed', role: 'assistant', kind: 'tool', text: '生成图片', status: 'failed' }]
  render(<EmbeddedTranscript messages={messages} onToggle={() => {}} />)
  expect(screen.queryByText('先核对参考图。')).toBeNull()
  expect(screen.getByText('生成图片 · 未完成')).toBeTruthy()
  expect(screen.getByText('第一轮完成')).toBeTruthy()
})
